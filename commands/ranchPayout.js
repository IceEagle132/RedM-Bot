const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  MessageFlags 
} = require('discord.js');
const fs = require('fs').promises; // For async file operations
const path = require('path'); // For resolving file paths
const { ranches } = require('../config.json'); // Load ranch details dynamically from config.json

module.exports = {
  name: 'payout',
  description: 'Send a payout message to the designated payout channels for each ranch.',
  
  async execute(message) {
    const ranchPayouts = [];

    // Load all ranch data and create temporary payout files
    for (const ranch of ranches) {
      try {
        const data = await fs.readFile(ranch.dataFile, 'utf8');
        const stats = JSON.parse(data);
        const ranchDetails = [];

        for (const [playerMention, statsData] of Object.entries(stats)) {
          const milkProfit = statsData.milk * 1.25;
          const eggsProfit = statsData.eggs * 1.25;
          const totalProfit = milkProfit + eggsProfit;

          ranchDetails.push({
            mention: playerMention,
            nickname: await getNicknameFromMention(message, playerMention),
            totalProfit,
            paid: false, // Always start as unpaid
          });
        }

        // Write to a temporary payout file
        const payoutFile = `./payouts${ranch.name.replace(/\s+/g, '')}.json`;
        await fs.writeFile(payoutFile, JSON.stringify(ranchDetails, null, 2), 'utf8');

        ranchPayouts.push({ 
          ranchName: ranch.name, 
          details: ranchDetails, 
          payoutFile 
        });
      } catch (error) {
        console.warn(`Failed to process ${ranch.dataFile}:`, error);
      }
    }

    if (ranchPayouts.length === 0) {
      await message.reply({ content: 'No data found across all ranches.' });
      return;
    }

    // Send payout details
    await sendPayoutsToChannels(ranchPayouts, message);
  }
};

async function sendPayoutsToChannels(ranchPayouts, message) {
  for (const ranch of ranchPayouts) {
    try {
      const embed = buildUpdatedEmbed(ranch);

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mark_self_paid_${ranch.ranchName}`)
          .setLabel('Mark Myself as Paid')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`admin_mark_paid_${ranch.ranchName}`)
          .setLabel('Admin Mark as Paid')
          .setStyle(ButtonStyle.Primary)
      );

      const payoutChannel = message.client.channels.cache.get(
        ranches.find(r => r.name === ranch.ranchName).payoutChannelId
      );

      if (!payoutChannel) {
        console.warn(`Payout channel for ${ranch.ranchName} not found.`);
        continue;
      }

      const sentMessage = await payoutChannel.send({
        embeds: [embed],
        components: [buttons],
      });

      setupCollectors(sentMessage, ranchPayouts, ranch);
    } catch (error) {
      console.error(`Failed to send payout message for ${ranch.ranchName}:`, error);
    }
  }
}

async function setupCollectors(sentMessage, ranchPayouts, ranch) {
  const collector = sentMessage.createMessageComponentCollector({ time: 60000 });

  collector.on('collect', async interaction => {
    if (interaction.customId.startsWith('mark_self_paid')) {
      await handleMarkSelfPaid(interaction, ranchPayouts, sentMessage);
    } else if (interaction.customId.startsWith('admin_mark_paid')) {
      await handleAdminMarkPaid(interaction, ranchPayouts, sentMessage);
    }
  });

  collector.on('end', () => {
    console.log('Collector expired.');
  });
}

async function handleMarkSelfPaid(interaction, ranchPayouts, sentMessage) {
  const userMention = `<@${interaction.user.id}>`;
  let found = false;
  let updatedRanch = null;

  ranchPayouts.forEach(ranch => {
    ranch.details.forEach(detail => {
      if (detail.mention === userMention && !detail.paid) {
        detail.paid = true;
        found = true;
        updatedRanch = ranch;
        console.log(`Marked ${detail.mention} as paid in ${ranch.ranchName}`);
      }
    });
  });

  if (!found) {
    await interaction.reply({
      content: 'You are not in the payout list or have already been marked as paid.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Save changes to temporary payout files
  await savePayoutData(ranchPayouts);

  // Check and delete payout files if all are paid
  await checkAndDeletePayoutFiles(ranchPayouts);

  // Rebuild and update the embed for the specific ranch
  if (updatedRanch) {
    const updatedEmbed = buildUpdatedEmbed(updatedRanch);
    await sentMessage.edit({ embeds: [updatedEmbed] });
  }

  await interaction.reply({
    content: '✅ You have been marked as paid.',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAdminMarkPaid(interaction, ranchPayouts, sentMessage) {
  const unpaidUsers = ranchPayouts.flatMap(ranch => 
    ranch.details
      .filter(detail => !detail.paid)
      .map(detail => ({
        label: detail.nickname || detail.mention,
        value: detail.mention
      }))
  );

  if (unpaidUsers.length === 0) {
    await interaction.reply({ 
      content: 'All users have already been marked as paid.', 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  const selectMenu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_user_to_mark_paid')
      .setPlaceholder('Select a user to mark as paid')
      .addOptions(unpaidUsers)
  );

  await interaction.reply({ 
    content: 'Select a user to mark as paid:', 
    components: [selectMenu], 
    flags: MessageFlags.Ephemeral 
  });

  const filter = i => i.customId === 'select_user_to_mark_paid' && i.user.id === interaction.user.id;
  const selectCollector = interaction.channel.createMessageComponentCollector({ filter, time: 60000, max: 1 });

  selectCollector.on('collect', async selectInteraction => {
    const selectedMention = selectInteraction.values[0];
    let found = false;
    let updatedRanch = null;

    ranchPayouts.forEach(ranch => {
      ranch.details.forEach(detail => {
        if (detail.mention === selectedMention && !detail.paid) {
          detail.paid = true;
          found = true;
          updatedRanch = ranch;
          console.log(`Admin marked ${detail.mention} as paid in ${ranch.ranchName}`);
        }
      });
    });

    if (!found) {
      await selectInteraction.reply({ 
        content: 'User not found in the payout list or already marked as paid.', 
        flags: MessageFlags.Ephemeral 
      });
      return;
    }

    await savePayoutData(ranchPayouts);

    // Check and delete payout files if all are paid
    await checkAndDeletePayoutFiles(ranchPayouts);

    // Rebuild and update the embed for the specific ranch
    if (updatedRanch) {
      const updatedEmbed = buildUpdatedEmbed(updatedRanch);
      await sentMessage.edit({ embeds: [updatedEmbed] });
    }

    await selectInteraction.reply({ 
      content: `✅ ${selectedMention} has been marked as paid.`, 
      flags: MessageFlags.Ephemeral 
    });
  });
}

async function savePayoutData(ranchPayouts) {
  try {
    await Promise.all(
      ranchPayouts.map(ranch =>
        fs.writeFile(path.resolve(ranch.payoutFile), JSON.stringify(ranch.details, null, 2), 'utf8')
      )
    );
    console.log('Payout data saved successfully.');
  } catch (error) {
    console.error('Failed to save payout data:', error);
  }
}

async function checkAndDeletePayoutFiles(ranchPayouts) {
  for (const ranch of ranchPayouts) {
    const allPaid = ranch.details.every(detail => detail.paid);
    if (allPaid) {
      try {
        await fs.unlink(path.resolve(ranch.payoutFile));
        console.log(`Deleted payout file for ${ranch.ranchName} as all users are paid.`);
      } catch (error) {
        console.error(`Failed to delete payout file for ${ranch.ranchName}:`, error);
      }
    }
  }
}

function buildUpdatedEmbed(ranchPayout) { // Accept a single ranchPayout object
  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('Payout Details')
    .setDescription('Here is your payout information:')
    .setTimestamp()
    .setFooter({ text: 'Ranch Management System' });

  const ranch = ranchPayout.ranchName;
  const ranchText = ranchPayout.details
    .map(detail => {
      const payoutLine = `**${detail.nickname || detail.mention}** **$${detail.totalProfit.toFixed(2)}**`;
      return detail.paid ? `~~${payoutLine}~~` : payoutLine;
    })
    .join('\n');

  embed.addFields({ 
    name: ranch, 
    value: ranchText || 'No data available', 
    inline: false 
  });

  return embed;
}

async function getNicknameFromMention(message, mention) {
  try {
    const userIdMatch = mention.match(/^<@!?(\d+)>$/);
    if (!userIdMatch) return null;

    const userId = userIdMatch[1];
    const member = await message.guild.members.fetch(userId).catch(() => null);
    return member ? member.displayName : null;
  } catch (error) { 
    console.error('Error fetching nickname:', error); 
    return null; 
  }
}