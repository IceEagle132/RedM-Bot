const fs = require('fs');
const { exec } = require('child_process');

module.exports = {
  name: 'wipe',
  description: 'Wipe the data files and restart the bot.',
  async execute(message) {
    // Check if the user has administrative permissions
    if (!message.member.permissions.has('ADMINISTRATOR')) {
      return message.reply('You do not have permission to use this command.');
    }

    // List of data files to wipe
    const dataFiles = [
      './playerStatsMilky.json',
      './playerStatsLockett.json'
    ];

    try {
      // Wipe each data file
      dataFiles.forEach(file => {
        if (fs.existsSync(file)) {
          fs.writeFileSync(file, '{}', 'utf8');
          console.log(`Wiped data file: ${file}`);
        } else {
          console.warn(`Data file not found: ${file}`);
        }
      });

      // Notify the user
      await message.reply('Data files wiped successfully. Restarting the bot...');

      // Restart the bot
      exec(`node "${process.argv[1]}"`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error restarting the bot: ${error.message}`);
          return;
        }
        console.log(`Bot restarted successfully:\n${stdout}`);
        process.exit(); // Exit the current process
      });
    } catch (error) {
      console.error('An error occurred while wiping data files:', error);
      message.reply('An error occurred while wiping data files. Check the logs for details.');
    }
  }
};