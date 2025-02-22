const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// Load config
const config = require('./config.json');
const { TOKEN, ranches } = config;

// Create the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
});

// Load utility functions
const { loadPlayerStats, savePlayerStats, updateEmbed } = require('./utils/stats');
const payoutCommand = require('./commands/ranchPayout');

// Command collection
client.commands = new Collection();

// Dynamically load commands from the "commands" folder
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
  console.log(`Loaded command: ${command.name}`);
}

let cronTaskInitialized = false; // Flag to track if the cron task is already scheduled

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

  if (!cronTaskInitialized) {
    // Schedule automated payouts for 7:55 AM on Wednesdays and Saturdays
    cron.schedule('55 23 * * 2,5', async () => {
      console.log('[Automated Payout] Starting payout process...');
      try {
        // Simulate a message object for the payout command
        const fakeMessage = {
          client,
          reply: (msg) => console.log(`[Automated Payout] Reply: ${msg}`),
        };
    
        await payoutCommand.execute(fakeMessage); // Run the payout logic once
        console.log(`[Automated Payout] Completed.`);
      } catch (error) {
        console.error(`[Automated Payout] Error:`, error);
      }
    });    
    console.log('[Automated Payout] Scheduler initialized.');
    cronTaskInitialized = true; // Set the flag to prevent duplicate scheduling
  }
});

// Role ID and Welcome Channel ID
const WELCOME_ROLE_ID = '1310082837185167434';
const WELCOME_CHANNEL_ID = '1330234206206300271';
const RANCH_NAME = 'Milky';
const RULES_CHANNEL_ID = '1318138310958518272';
const RANCH_AVATAR_URL = 'https://i.imgur.com/PlixUY5.jpeg'; // Replace with the URL of your ranch avatar

// Pool of random welcome messages
const welcomeMessages = [
  `🎉 Welcome ${RANCH_NAME}'s newest Ranch Hand, **{displayName}**! Saddle up and get ready for some ranching fun! Be sure to check out <#${RULES_CHANNEL_ID}> for the ranch rules.`,
  `🤠 Howdy, **{displayName}**! Welcome to the ${RANCH_NAME} Ranch. Grab your boots and hat—time to get to work! Don’t forget to read <#${RULES_CHANNEL_ID}> for all the important rules.`,
  `🌟 Yeehaw! **{displayName}** just joined the ${RANCH_NAME} Ranch. Welcome aboard, partner! Make sure you read <#${RULES_CHANNEL_ID}> to keep things running smoothly.`,
  `🐄 Welcome to the herd, **{displayName}**! The ${RANCH_NAME} Ranch is lucky to have you. Please take a moment to read <#${RULES_CHANNEL_ID}> before starting.`,
  `🌾 A big ranch welcome to **{displayName}**! Let's make ${RANCH_NAME} Ranch the best one out there! First things first—check out <#${RULES_CHANNEL_ID}> to learn the ranch rules.`,
];

client.on('guildMemberUpdate', (oldMember, newMember) => {
  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  // Check if the welcome role was added
  if (!oldRoles.has(WELCOME_ROLE_ID) && newRoles.has(WELCOME_ROLE_ID)) {
    const welcomeChannel = newMember.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (welcomeChannel) {
      // Use the member's display name (nickname or username)
      const displayName = newMember.displayName;

      // Choose a random welcome message
      const randomMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]
        .replace(/{displayName}/gi, `**${displayName}**`); // Replace placeholder with bolded display name

      // Create the embed
      const embed = new EmbedBuilder()
        .setColor(0x00ff00) // Green color
        .setTitle(`🤠 Welcome to the ${RANCH_NAME} Ranch!`)
        .setDescription(randomMessage)
        .setThumbnail(RANCH_AVATAR_URL) // Use the ranch avatar as the thumbnail
        .setTimestamp()
        .setFooter({
          text: 'Ranch Management System',
          iconURL: client.user.displayAvatarURL(),
        });

      // Send the embed
      welcomeChannel
        .send({ embeds: [embed] })
        .then(() => console.log(`[Welcome Message] Sent welcome embed for ${newMember.user.tag} in ${RANCH_NAME} Ranch`))
        .catch((err) =>
          console.error(`[Welcome Message] Failed to send embed for ${newMember.user.tag}:`, err)
        );
    } else {
      console.error(`[Welcome Message] Welcome channel not found: ${WELCOME_CHANNEL_ID}`);
    }
  }
});

// On messageCreate
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  //if (message.author.bot) return; // ToDO Fix

  console.log(`Message received in channel ${message.channel.id}: "${message.content}"`);

  // Handle commands starting with "!"
  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).trim().split(/ +/); // Remove "!" and split arguments
    const commandName = args.shift().toLowerCase(); // Extract command name

    const command = client.commands.get(commandName);

    if (!command) {
      console.log(`Command !${commandName} not found.`);
      return;
    }

    try {
      await command.execute(message, args); // Pass args to the command
    } catch (error) {
      console.error(`Error executing command !${commandName}:`, error);
      message.reply('❌ There was an error while executing that command.');
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