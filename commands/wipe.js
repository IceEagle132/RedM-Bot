const fs = require('fs');
const { ranches } = require('../config.json');

module.exports = {
  name: 'wipe',
  description: 'Wipe the data files.',
  async execute(message) {
    if (!message.member.permissions.has('ADMINISTRATOR')) {
      return message.reply('You do not have permission to use this command.')
        .then(msg => setTimeout(() => msg.delete(), 5000));
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

      // Notify user and delete messages
      message.reply('Data files wiped successfully.')
        .then(msg => setTimeout(() => msg.delete(), 5000));

      setTimeout(() => message.delete(), 5000);
    } catch (error) {
      console.error('Error wiping data files:', error);
      message.reply('An error occurred while wiping data files. Check logs.')
        .then(msg => setTimeout(() => msg.delete(), 5000));
    }
  }
};