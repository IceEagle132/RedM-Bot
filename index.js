const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load config
const config = require('./config.json');
const { TOKEN, ranches } = config;

// Create the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// Load utility functions
const { loadPlayerStats, savePlayerStats, updateEmbed } = require('./utils/stats');

// Command collection
client.commands = new Collection();

// Dynamically load commands from the "commands" folder
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
  console.log(`Loaded command: ${command.name}`);
}

// On bot ready
client.on('ready', async () => {
  console.log(`[BOT READY] Logged in as ${client.user.tag}`);

  for (const ranch of ranches) {
    console.log(`[${ranch.name}] Initializing...`);
    loadPlayerStats(ranch); // Ensure this is called
    console.log(`[${ranch.name}] Stats after loading:`, ranch.playerStats);

    const targetChannel = client.channels.cache.get(ranch.targetChannelId);
    if (!targetChannel) {
      console.error(`[${ranch.name}] Target channel not found: ${ranch.targetChannelId}`);
      continue;
    }

    try {
      const messages = await targetChannel.messages.fetch({ limit: 10 });
      const existingEmbed = messages.find(
        (msg) => msg.author.id === client.user.id && msg.embeds.length > 0
      );
      if (existingEmbed) {
        ranch.embedMessageId = existingEmbed.id;
        console.log(`[${ranch.name}] Found existing embed: ${existingEmbed.id}`);
      } else {
        console.log(`[${ranch.name}] No embed found; will create one now.`);
      }
      await updateEmbed(ranch, client);
    } catch (err) {
      console.error(`[${ranch.name}] Failed to fetch messages:`, err);
    }
  }
});

// On messageCreate
client.on('messageCreate', async (message) => {
  console.log(`Message received in channel ${message.channel.id}: "${message.content}"`);

  // Handle !payout command globally
  if (message.content.startsWith('!payout')) {
    const command = client.commands.get('payout');
    if (command) {
      try {
        await command.execute(message);
      } catch (error) {
        console.error('Error executing command:', error);
        message.reply('There was an error while executing that command.');
      }
    }
    return;
  }

  // Handle !wipe command globally
  if (message.content.startsWith('!wipe')) {
    const command = client.commands.get('wipe');
    if (command) {
      try {
        await command.execute(message);
      } catch (error) {
        console.error('Error executing command:', error);
        message.reply('There was an error while executing that command.');
      }
    }
    return;
  }

  const ranch = ranches.find(r => r.sourceChannelId === message.channel.id);
  if (!ranch) {
    console.log(`Message not from a monitored channel. Skipping.`);
    return;
  }

  console.log(`[${ranch.name}] Processing message...`);

  // Extract content from embed if message.content is empty
  let textToMatch = message.content;
  if (!textToMatch && message.embeds.length > 0) {
    console.log(`[${ranch.name}] Message has no content. Checking embeds...`);
    textToMatch = message.embeds.map(embed => `${embed.title}\n${embed.description}`).join('\n');
  }

  if (!textToMatch) {
    console.log(`[${ranch.name}] No usable text found in message. Skipping.`);
    return;
  }

  console.log(`[${ranch.name}] Text to match: "${textToMatch}"`);

  // Detect Cattle Sale or Purchase
  if (/Cattle Sale|Bought Cattle|Sold/i.test(textToMatch)) {
    console.log(`[${ranch.name}] Detected a cattle transaction message.`);

    const purchaseRegex = /Player\s\**(.+?)\**\sbought\s\**(\d+)\**\s\**(.+?)\**\scattle\sfor\s\**([\d\.\$]+)\**/i;
    const saleRegex = /Player\s\**(.+?)\**\ssold\s\**(\d+)\**\s\**(.+?)\**\sfor\s\**([\d\.\$]+)\**/i;

    let match, transactionType;
    if ((match = textToMatch.match(purchaseRegex))) {
        transactionType = "bought";
    } else if ((match = textToMatch.match(saleRegex))) {
        transactionType = "sold";
    }

    if (match) {
        const [, playerName, count, cattleType, price] = match;
        console.log({ playerName, count, cattleType, price, transactionType }); // Debugging
        await postHerdLogMessage(ranch, playerName, cattleType, count, price, transactionType);
    } else {
        console.log(`[${ranch.name}] No matching cattle transaction pattern.`);
    }
    return;
  }

  // Handle milk/eggs updates
  const playerRegex = /(<@!?\d+>)\s\d+\s(.+?)(?=\n|$)/;
  const itemRegex = /(Eggs|Milk)\sAdded/i;
  const quantityRegex = /Added\s(?:Eggs|Milk)\sto\sranch\sid\s\d+\s:\s(\d+)/i;

  const playerMatch = textToMatch.match(playerRegex);
  const itemMatch = textToMatch.match(itemRegex);
  const quantityMatch = textToMatch.match(quantityRegex);

  console.log(`Regex results:`, { playerMatch, itemMatch, quantityMatch });

  if (!playerMatch || !itemMatch || !quantityMatch) {
    console.log(`[${ranch.name}] Message didn't match expected format. Skipping.`);
    return;
  }

  const playerMention = playerMatch[1].trim(); // The mention (e.g., <@145685281775812608>)
  const playerName = playerMatch[2].trim();   // The username (e.g., Xx_JussKiddin_xX)
  const itemType = itemMatch[1].toLowerCase();
  const quantity = parseInt(quantityMatch[1], 10);

  console.log(`[${ranch.name}] Updating stats: ${playerMention} (${playerName}) collected ${quantity} ${itemType}.`);

  // Initialize player stats if not already present
  if (!ranch.playerStats[playerMention]) {
    ranch.playerStats[playerMention] = { eggs: 0, milk: 0 };
  }
  ranch.playerStats[playerMention][itemType] += quantity;

  console.log(`[${ranch.name}] Updated stats:`, ranch.playerStats);

  // Save stats to file
  savePlayerStats(ranch);

  // Update the embed
  console.log(`[${ranch.name}] Updating embed...`);
  await updateEmbed(ranch, client);
});

// Helper function to post herd-log messages
async function postHerdLogMessage(ranch, playerName, cattleType, count, price, transactionType) {
  console.log({ playerName, count, cattleType, price, transactionType }); // Debugging
  try {
    const herdLogChannel = client.channels.cache.get(ranch.herdLogChannelId);
    if (!herdLogChannel) {
      console.error(`[${ranch.name}] Herd-log channel not found!`);
      return;
    }

    // Set the title dynamically based on the transaction type
    const embedTitle = `${ranch.name} Cattle ${transactionType === "bought" ? "Purchased" : "Sold"}`;

    const embed = new EmbedBuilder()
      .setColor(transactionType === "bought" ? 0xff0000 : 0x00ff00) // Green for sale, Red for bought
      .setTitle(`**${embedTitle}**`)
      .setDescription(
        `**${playerName}** ${transactionType} **${count} ${cattleType}** for **${price}**`
      )
      .setTimestamp()
      .setFooter({ text: 'Ranch Management System' });

    await herdLogChannel.send({ embeds: [embed] });
    console.log(`[${ranch.name}] Herd-log embed posted for player: ${playerName}`);
  } catch (error) {
    console.error(`[${ranch.name}] Failed to post herd-log embed:`, error);
  }
}

// Login
client.login(TOKEN);