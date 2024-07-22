const { connectWhatsapp } = require('./index');
const moment = require('moment-timezone');

console.log('Starting WhatsApp Bot worker...');
console.log('Server time:', new Date().toISOString());
console.log('Server timezone:', moment.tz.guess());

connectWhatsapp();

process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.log('Uncaught Exception:', error);
});