const fs = require('fs');
const { EmbedBuilder } = require('discord.js');

/**
 * Load player stats from a file.
 * @param {Object} ranch - The ranch configuration object.
 */
function loadPlayerStats(ranch) {
  if (fs.existsSync(ranch.dataFile)) {
    console.log(`[${ranch.name}] Loading data from ${ranch.dataFile}`);
    try {
      const data = fs.readFileSync(ranch.dataFile, 'utf8');
      ranch.playerStats = JSON.parse(data);
      console.log(`[${ranch.name}] Loaded data:`, ranch.playerStats);
    } catch (error) {
      console.error(`[${ranch.name}] Failed to parse data file: ${error.message}`);
      ranch.playerStats = {}; // Initialize as empty if parsing fails
    }
  } else {
    console.log(`[${ranch.name}] No data file found; creating a new one.`);
    ranch.playerStats = {};
    savePlayerStats(ranch);
    console.log(`[${ranch.name}] Created a new data file: ${ranch.dataFile}`);
  }
}

/**
 * Save player stats to a file.
 * @param {Object} ranch - The ranch configuration object.
 */
function savePlayerStats(ranch) {
  try {
    fs.writeFileSync(ranch.dataFile, JSON.stringify(ranch.playerStats, null, 2), 'utf8');
    console.log(`[${ranch.name}] Saved data to ${ranch.dataFile}`);
  } catch (error) {
    console.error(`[${ranch.name}] Error saving data:`, error);
  }
}

/**
 * Calculate the current tracking period based on payout days.
 * @returns {Object} An object containing start and end dates in MM/DD format.
 */
function getCurrentTrackingPeriod() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 (Sunday) to 6 (Saturday)

  // Define payout days: Wednesday (3) and Saturday (6)
  const payoutDays = [3, 6];

  // Find the most recent payout day
  let lastPayoutDay = dayOfWeek;
  while (!payoutDays.includes(lastPayoutDay)) {
    lastPayoutDay = (lastPayoutDay - 1 + 7) % 7;
  }

  // Calculate last payout date
  const lastPayoutDate = new Date(today);
  lastPayoutDate.setDate(today.getDate() - ((dayOfWeek - lastPayoutDay + 7) % 7));

  // Determine next payout day
  const nextPayoutDay = payoutDays.find(day => day > lastPayoutDay) || payoutDays[0];

  // Calculate next payout date
  const nextPayoutDate = new Date(lastPayoutDate);
  const daysUntilNextPayout = (nextPayoutDay - lastPayoutDay + 7) % 7 || 7; // Ensure at least 1 week ahead if same day
  nextPayoutDate.setDate(lastPayoutDate.getDate() + daysUntilNextPayout);

  // Format dates as MM/DD
  const formatDate = (date) => `${date.getMonth() + 1}/${date.getDate()}`;

  return {
    start: formatDate(lastPayoutDate),
    end: formatDate(nextPayoutDate),
  };
}

/**
 * Update the embed for a ranch.
 * @param {Object} ranch - The ranch configuration object.
 * @param {Object} client - The Discord client instance.
 */
async function updateEmbed(ranch, client) {
  try {
    const targetChannel = client.channels.cache.get(ranch.targetChannelId);
    if (!targetChannel) {
      console.error(`[${ranch.name}] Target channel not found! ID: ${ranch.targetChannelId}`);
      return;
    }

    let targetMessage = null;
    if (ranch.embedMessageId) {
      targetMessage = await targetChannel.messages.fetch(ranch.embedMessageId).catch(() => null);
    }

    // Get current tracking period
    const trackingPeriod = getCurrentTrackingPeriod();

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(ranch.name.toUpperCase())
      .setDescription(`🥛 Tracking: ${trackingPeriod.start} - ${trackingPeriod.end} 🥚`)
      .setTimestamp();

    const playerEntries = Object.entries(ranch.playerStats);

    // Build fields for two-column layout
    const fields = [];
    for (let i = 0; i < playerEntries.length; i++) {
      const [playerMention, stats] = playerEntries[i];
      const userId = playerMention.replace(/[<@!>]/g, ''); // Extract user ID from mention
      const guild = targetChannel.guild;

      let displayName = playerMention; // Default to mention
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null); // Fetch member by ID
        displayName = member ? member.displayName : displayName; // Use nickname if available
      }

      const profit = (stats.milk * 1.25) + (stats.eggs * 1.25);
      fields.push({
        name: `${displayName}`, // Use nickname or mention
        value: `🥛 Milk: ${stats.milk}\n🥚 Eggs: ${stats.eggs}\n💰 Profit: $${profit.toFixed(2)}`,
        inline: true,
      });
    }

    // Calculate total profit
    const totalProfit = playerEntries.reduce(
      (sum, [, stats]) => sum + stats.milk * 1.25 + stats.eggs * 1.25,
      0
    );

    // Add fields and footer
    if (fields.length === 0) {
      embed.setDescription(`🥛 Tracking: ${trackingPeriod.start} - ${trackingPeriod.end} 🥚\nNo player stats available.`);
    } else {
      embed.addFields(fields);
      embed.setFooter({ text: `💰 Total Profit: $${totalProfit.toFixed(2)}` });
    }

    if (targetMessage) {
      console.log(`[${ranch.name}] Editing existing embed.`);
      await targetMessage.edit({ embeds: [embed] });
      console.log(`[${ranch.name}] Embed updated successfully.`);
    } else {
      console.log(`[${ranch.name}] Sending new embed.`);
      const newMessage = await targetChannel.send({ embeds: [embed] });
      ranch.embedMessageId = newMessage.id;
      console.log(`[${ranch.name}] Created new embed: ${ranch.embedMessageId}`);
    }
  } catch (error) {
    console.error(`[${ranch.name}] Failed to update embed:`, error);
  }
}

module.exports = { loadPlayerStats, savePlayerStats, updateEmbed };