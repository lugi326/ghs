const { makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const NodeCache = require('node-cache');
const qrcode = require('qrcode-terminal');
const util = require('util');
const cron = require('node-cron');
const moment = require('moment-timezone');
const { getData, setData, updateData, deleteData, addTask, getAllTasks } = require('./firebaseService');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

let qrCode = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Setup logging
const log_file = fs.createWriteStream(__dirname + '/debug.log', { flags: 'a' });
const logToFile = (data) => log_file.write(util.format(data) + '\n');

// Decode message helper
const decodeMessage = (message) => (typeof message === 'string' ? Buffer.from(message, 'utf-8').toString() : message);

// Query Flowise AI API
const query = async (data, sessionId) => {
  try {
    const response = await fetch("https://flowisefrest.onrender.com/api/v1/prediction/e5d4a781-a3a5-4631-8cdd-3972b57bcba7", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, overrideConfig: { sessionId } })
    });
    return await response.json();
  } catch (error) {
    console.error('Error saat melakukan query:', error);
    logToFile('Error saat melakukan query: ' + error.message);
    throw error;
  }
};

// Send message with retries
const sendMessageWithRetry = async (socket, phone, message) => {
  try {
    await socket.sendMessage(phone, message);
  } catch (error) {
    console.error('Error saat mengirim pesan:', error);
    logToFile('Error saat mengirim pesan: ' + error.message);
    throw error;
  }
};

// Calculate remaining days
const calculateRemainingDays = (deadline) => {
  const currentDate = moment().tz('Asia/Jakarta');
  const [day, month] = deadline.split('.').map(Number);
  const deadlineDate = moment().tz('Asia/Jakarta').set({date: day, month: month - 1});
  
  if (deadlineDate.isBefore(currentDate)) {
    deadlineDate.add(1, 'year');
  }
  
  const remainingDays = deadlineDate.diff(currentDate, 'days');
  return isNaN(remainingDays) ? 'Invalid date' : remainingDays;
};

// Connect to WhatsApp
const connectWhatsapp = async () => {
  try {
    console.log('Memulai koneksi WhatsApp...');
    logToFile('Memulai koneksi WhatsApp...');
    const auth = await useMultiFileAuthState("sessionDir");
    const msgRetryCounterCache = new NodeCache();

    const socket = makeWASocket({
      printQRInTerminal: false,
      browser: ["DAPABOT", "", ""],
      auth: auth.state,
      logger: pino({ level: "silent" }),
      msgRetryCounterMap: msgRetryCounterCache,
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      retryRequestDelayMs: 5000,
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }
        return message;
      },
    });

    socket.ev.on("creds.update", auth.saveCreds);

    socket.ev.on("connection.update", ({ connection, qr }) => {
      if (connection === 'open') {
        console.log("WhatsApp Active..");
        console.log('Bot ID:', socket.user.id);
        logToFile("WhatsApp Active..");
        logToFile('Bot ID: ' + socket.user.id);
        qrCode = null;
        reconnectAttempts = 0;
      } else if (connection === 'close') {
        console.log("WhatsApp Closed..");
        logToFile("WhatsApp Closed..");
        reconnect();
      } else if (connection === 'connecting') {
        console.log('WhatsApp Connecting');
        logToFile('WhatsApp Connecting');
      }
      if (qr) {
        console.log('New QR Code received');
        logToFile('New QR Code received');
        qrcode.generate(qr, { small: true });
        qrCode = qr;
      }
    });

    socket.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const message = messages[0];
        console.log('Raw message:', JSON.stringify(message, null, 2));
        logToFile('Raw message: ' + JSON.stringify(message, null, 2));

        let pesan = '';
        let isGroupMessage = message.key.remoteJid.endsWith('@g.us');
        let isMentioned = false;

        if (message.message && message.message.conversation) {
          pesan = decodeMessage(message.message.conversation);
        } else if (message.message && message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
          pesan = decodeMessage(message.message.extendedTextMessage.text);
        } else {
          console.log('Unsupported message type');
          logToFile('Unsupported message type');
          return;
        }

        const botNumber = socket.user.id.split(':')[0];
        isMentioned = pesan.includes(`@${botNumber}`);

        const phone = message.key.remoteJid;
        console.log('Decoded message:', pesan);
        logToFile('Decoded message: ' + pesan);
        console.log('Is Group Message:', isGroupMessage);
        console.log('Is Mentioned:', isMentioned);
        console.log('Bot Number:', botNumber);
        logToFile(`Is Group Message: ${isGroupMessage}, Is Mentioned: ${isMentioned}, Bot Number: ${botNumber}`);

        if (!message.key.fromMe) {
          if (!isGroupMessage || (isGroupMessage && isMentioned)) {
            console.log('Processing message. isGroupMessage:', isGroupMessage, 'isMentioned:', isMentioned);
            logToFile(`Processing message. isGroupMessage: ${isGroupMessage}, isMentioned: ${isMentioned}`);

            const sessionId = phone;

            if (isMentioned) {
              pesan = pesan.replace(`@${botNumber}`, '').trim();
            }

            if (pesan.startsWith('.tugas ')) {
              const content = pesan.replace('.tugas ', '').trim();
              if (content.toLowerCase() === 'info') {
                const tasks = await getAllTasks();
                if (tasks) {
                  let infoMessage = 'T.G ';
                  Object.keys(tasks).forEach((key, index) => {
                    const task = tasks[key];
                    const remainingDays = calculateRemainingDays(task.deadline);
                    infoMessage += `${index + 1}. Dosen: ${task.dosen}, Tugas: ${task.namaTugas}, Sisa: ${remainingDays} hari`;
                    if (index < Object.keys(tasks).length - 1) {
                      infoMessage += ' ';
                    }
                  });
                  
                  const response = await query({ question: infoMessage }, sessionId);
                  console.log('Flowise response for task info:', response);
                  logToFile('Flowise response for task info: ' + JSON.stringify(response));
                  const { text } = response;
                  await sendMessageWithRetry(socket, phone, { text: text });
                } else {
                  const response = await query({ question: "T.G Tidak ada tugas yang ditemukan." }, sessionId);
                  const { text } = response;
                  await sendMessageWithRetry(socket, phone, { text: text });
                }
              } else {
                const [dosen, namaTugas, deadline] = content.split(',').map(item => item.trim());
                if (dosen && namaTugas && deadline) {
                  const dateRegex = /^(\d{2})\.(\d{2})$/;
                  if (dateRegex.test(deadline)) {
                    await addTask(dosen, namaTugas, deadline);
                    await sendMessageWithRetry(socket, phone, { text: 'Tugas berhasil ditambahkan.' });
                  } else {
                    await sendMessageWithRetry(socket, phone, { text: 'Format tanggal tidak valid. Gunakan format DD.MM' });
                  }
                } else {
                  await sendMessageWithRetry(socket, phone, { text: 'Format tidak valid. Gunakan: .tugas (dosen), (nama tugas), (deadline dalam format DD.MM)' });
                }
              }
            } else {
              const response = await query({ question: pesan }, sessionId);
              console.log('API response:', response);
              logToFile('API response: ' + JSON.stringify(response));
              const { text } = response;
              await sendMessageWithRetry(socket, phone, { text: text });
            }
          } else {
            console.log('Pesan grup diabaikan karena bot tidak di-tag');
            logToFile('Pesan grup diabaikan karena bot tidak di-tag');
          }
        }
      } catch (error) {
        console.error('Error saat memproses pesan:', error);
        logToFile('Error saat memproses pesan: ' + error.message);
        if (error.name === 'TimeoutError' || (error.output && error.output.statusCode === 408)) {
          console.log('Timeout saat memproses pesan, mencoba lagi...');
          logToFile('Timeout saat memproses pesan, mencoba lagi...');
          // Implement retry logic here
        }
      }
    });

    // Schedule task to check deadlines
    cron.schedule('0 12 * * *', checkDeadlines, {
      timezone: "Asia/Jakarta"
    });

    async function checkDeadlines() {
      console.log('Checking deadlines...');
      logToFile('Checking deadlines...');
      const tasks = await getAllTasks();
      if (tasks) {
        Object.keys(tasks).forEach(async (key) => {
          const task = tasks[key];
          const remainingDays = calculateRemainingDays(task.deadline);
          if (remainingDays <= 3 && remainingDays > 0) {
            const message = `Reminder: Tugas "${task.namaTugas}" dari dosen ${task.dosen} akan jatuh tempo dalam ${remainingDays} hari.`;
            // Send reminder to a specific group or user
            // await sendMessageWithRetry(socket, 'group-id@g.us', { text: message });
            console.log(message);
            logToFile(message);
          }
        });
      }
    }

  } catch (error) {
    console.error('Error in connectWhatsapp:', error);
    logToFile('Error in connectWhatsapp: ' + error.message);
    reconnect();
  }
};

const reconnect = () => {
  if (reconnectAttempts < maxReconnectAttempts) {
    reconnectAttempts++;
    console.log(`Attempting to reconnect... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
    logToFile(`Attempting to reconnect... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
    setTimeout(connectWhatsapp, 5000 * reconnectAttempts);
  } else {
    console.log('Max reconnection attempts reached. Exiting...');
    logToFile('Max reconnection attempts reached. Exiting...');
    process.exit(1);
  }
};

module.exports = { connectWhatsapp };