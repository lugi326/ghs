const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

console.log('Firebase project ID:', serviceAccount.project_id);
console.log('Firebase private key ID:', serviceAccount.private_key_id.substring(0, 5) + '...');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://wav1-e35d1-default-rtdb.asia-southeast1.firebasedatabase.app/'
});

const db = admin.database();

const getData = async (path) => {
  try {
    const ref = db.ref(path);
    const snapshot = await ref.once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error saat mengambil data:', error);
    throw error;
  }
};

const setData = async (path, data) => {
  try {
    const ref = db.ref(path);
    await ref.set(data);
    console.log('Data berhasil disimpan:', data);
  } catch (error) {
    console.error('Error saat menyimpan data:', error);
    throw error;
  }
};

const updateData = async (path, data) => {
  try {
    const ref = db.ref(path);
    await ref.update(data);
    console.log('Data berhasil diperbarui:', data);
  } catch (error) {
    console.error('Error saat memperbarui data:', error);
    throw error;
  }
};

const deleteData = async (path) => {
  try {
    const ref = db.ref(path);
    await ref.remove();
    console.log('Data berhasil dihapus dari path:', path);
  } catch (error) {
    console.error('Error saat menghapus data:', error);
    throw error;
  }
};

const addTask = async (dosen, namaTugas, deadline) => {
  try {
    const tasksRef = db.ref('tasks');
    const newTaskRef = tasksRef.push();
    await newTaskRef.set({
      dosen,
      namaTugas,
      deadline
    });
    console.log('Tugas berhasil ditambahkan:', { dosen, namaTugas, deadline });
  } catch (error) {
    console.error('Error saat menambahkan tugas:', error);
    throw error;
  }
};

const getAllTasks = async () => {
  try {
    const tasksRef = db.ref('tasks');
    const snapshot = await tasksRef.once('value');
    return snapshot.val();
  } catch (error) {
    console.error('Error saat mengambil semua tugas:', error);
    throw error;
  }
};

module.exports = {
  getData,
  setData,
  updateData,
  deleteData,
  addTask,
  getAllTasks
};