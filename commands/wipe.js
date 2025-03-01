const fs = require('fs');
const { ranches } = require('../config.json');
const { updateEmbed } = require('../utils/stats'); // Add this import

module.exports = {
  name: 'wipe',
  description: 'Wipe the data files and reset embeds.',
  async execute(message) {
    if (!message.member.permissions.has('ADMINISTRATOR')) {
      return message.channel.send('You do not have permission to use this command.')
        .then(msg => setTimeout(() => {
          if (msg.deletable) msg.delete().catch(console.error);
        }, 5000))
        .catch(console.error);
    }

    try {
      ranches.forEach(ranch => {
        if (fs.existsSync(ranch.dataFile)) {
          fs.writeFileSync(ranch.dataFile, '{}', 'utf8');
          console.log(`Wiped data file: ${ranch.dataFile}`);
        } else {
          console.warn(`Data file not found: ${ranch.dataFile}`);
        }

        if (ranch.playerStats) {
          ranch.playerStats = {};
          console.log(`Cleared in-memory stats for ranch: ${ranch.name}`);
        }
      });

      // Notify user
      const notifyMsg = await message.channel.send('Data files wiped successfully. Embeds will be updated.')
        .catch(console.error);

      if (notifyMsg) {
        setTimeout(() => {
          if (notifyMsg.deletable) notifyMsg.delete().catch(console.error);
        }, 5000);
      }

      // ✅ Update embeds after wipe
      const client = message.client; // Get bot client
      for (const ranch of ranches) {
        await updateEmbed(ranch, client); // Update the embed
      }

      // ✅ Delete original command message safely
      setTimeout(() => {
        if (message.deletable) {
          message.delete().catch(error => {
            if (error.code !== 10008) console.error("Failed to delete message:", error);
          });
        }
      }, 5000);

    } catch (error) {
      console.error('Error wiping data files:', error);
      const errorMsg = await message.channel.send('An error occurred while wiping data files. Check logs.')
        .catch(console.error);

      if (errorMsg) {
        setTimeout(() => {
          if (errorMsg.deletable) errorMsg.delete().catch(console.error);
        }, 5000);
      }
    }
  }
};