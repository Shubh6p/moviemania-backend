const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const bodyParser = require('body-parser');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use('/images', express.static(path.join(__dirname, '..', 'images')));
app.use(express.static(path.join(__dirname, '..', '"MovieMania_Final-main"')));

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKEND_DIR = __dirname;

function readJSON(file, location = 'data') {
  const dir = location === 'backend' ? BACKEND_DIR : DATA_DIR;
  const filePath = path.join(dir, file);
  if (!fs.existsSync(filePath)) return file === 'series.json' ? {} : [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(file, data, location = 'data') {
  const dir = location === 'backend' ? BACKEND_DIR : DATA_DIR;
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
}

function logNotification(message) {
  const logPath = path.join(__dirname, '..', 'notifications.log');
  const log = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(logPath, log);
}

// ============ Movies & Series ============

app.get('/api/movies', (req, res) => {
  const moviesPath = path.join(__dirname, 'movies.json');
  fs.readFile(moviesPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading movies.json:', err);
      return res.status(500).json({ error: 'Failed to load movies data' });
    }
    try {
      const movies = JSON.parse(data);
      res.json(movies);
    } catch (parseError) {
      console.error('Error parsing movies.json:', parseError);
      res.status(500).json({ error: 'Invalid JSON format in movies.json' });
    }
  });
});

app.get('/api/series', (req, res) => {
  const seriesPath = path.join(__dirname, 'series.json');
  fs.readFile(seriesPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading series.json:', err);
      return res.status(500).json({ error: 'Failed to load series data' });
    }
    try {
      const series = JSON.parse(data);
      res.json(series);
    } catch (parseError) {
      console.error('Error parsing series.json:', parseError);
      res.status(500).json({ error: 'Invalid JSON format in series.json' });
    }
  });
});

// ============ Auth & Profile ============

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const admins = readJSON('admins.json');
  const user = admins.find(a => a.username === username && a.password === password);
  if (!user) return res.json({ success: false, message: 'Invalid credentials' });

  const sessions = readJSON('sessions.json');
  sessions.push({ username, ip: req.ip, timestamp: Date.now() });
  writeJSON('sessions.json', sessions);

  user.lastLogin = { timestamp: Date.now(), ip: req.ip };
  writeJSON('admins.json', admins);
  logNotification(`${username} logged in`);
  res.json({ success: true, user });
});

app.get('/api/profile', (req, res) => {
  const { username } = req.query;
  const admins = readJSON('admins.json');
  const user = admins.find(u => u.username === username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ============ Admin Management ============

app.get('/api/admins', (req, res) => {
  res.json(readJSON('admins.json'));
});

app.post('/api/admins', (req, res) => {
  const admins = readJSON('admins.json');
  const { username, password, role } = req.body;
  if (admins.find(a => a.username === username)) {
    return res.json({ success: false, error: 'Username already exists' });
  }
  admins.push({ username, password, role, createdAt: new Date().toISOString() });
  writeJSON('admins.json', admins);
  logNotification(`Admin added: ${username}`);
  res.json({ success: true });
});

app.put('/api/admins/:username', (req, res) => {
  const admins = readJSON('admins.json');
  const index = admins.findIndex(a => a.username === req.params.username);
  if (index === -1) return res.json({ success: false, error: 'Not found' });

  const updates = req.body;
  if (updates.password) admins[index].password = updates.password;
  if (updates.newUsername) admins[index].username = updates.newUsername;
  if (updates.role) admins[index].role = updates.role;

  writeJSON('admins.json', admins);
  res.json({ success: true });
});

app.delete('/api/admins/:username', (req, res) => {
  let admins = readJSON('admins.json');
  admins = admins.filter(a => a.username !== req.params.username);
  writeJSON('admins.json', admins);
  logNotification(`Admin deleted: ${req.params.username}`);
  res.json({ success: true });
});

// ============ Sessions ============

app.get('/api/sessions', (req, res) => {
  res.json(readJSON('sessions.json'));
});

// ============ Add Movies & Series ============

app.post('/save/movies', (req, res) => {
  const movies = readJSON('movies.json', 'backend');
  const incoming = req.body;

  if (!incoming.id || !incoming.title) {
    return res.status(400).send("❌ Missing movie ID or title.");
  }

  movies.unshift(incoming);
  writeJSON('movies.json', movies, 'backend');

  const addedBy = incoming.addedBy ? ` by ${incoming.addedBy}` : '';
  logNotification(`Movie added: ${req.body.title} by ${req.body.addedBy || "unknown"}`);
  res.send('✅ Movie saved');
});

app.post('/save/series', (req, res) => {
  const series = readJSON('series.json', 'backend');
  const incoming = req.body;

  const reordered = { ...incoming, ...series };
  writeJSON('series.json', reordered, 'backend');

  const seriesName = Object.keys(incoming)[0];
  const addedBy = incoming[seriesName].addedBy || "unknown";
  logNotification(`Series - ${seriesName} added by ${addedBy}`);
  res.send('✅ Series saved');
});

// ============ Poster Upload ============

const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

app.post('/upload-poster', upload.single('poster'), (req, res) => {
  const ext = path.extname(req.file.originalname);
  const destName = `${Date.now()}${ext}`;
  const destPath = path.join(__dirname, '..', 'images', destName);
  fs.renameSync(req.file.path, destPath);
  res.send(`success:${destName}`);
});

// ============ Analytics ============

app.get('/api/stats', (req, res) => {
  const movies = readJSON('movies.json', 'backend');
  const series = readJSON('series.json', 'backend');
  const admins = readJSON('admins.json');
  const sessions = readJSON('sessions.json');

  const recentLogins = sessions.filter(s =>
    Date.now() - s.timestamp < 7 * 24 * 60 * 60 * 1000
  ).length;

  res.json({
    totalMovies: movies.length,
    totalSeries: Object.keys(series).length,
    totalAdmins: admins.length,
    recentLogins
  });
});

// ============ Notifications ============

app.get('/api/notifications', (req, res) => {
  const logPath = path.join(__dirname, '..', 'notifications.log');
  if (!fs.existsSync(logPath)) return res.json([]);
  const logs = fs.readFileSync(logPath, 'utf-8')
    .split('\n').filter(Boolean)
    .map(line => {
      const match = line.match(/\[(.*?)\]\s(.+)/);
      return { timestamp: new Date(match[1]).getTime(), message: match[2] };
    });
  res.json(logs);
});

app.delete('/api/notifications/delete', (req, res) => {
  const { timestamps } = req.body; // array of timestamps to delete

  const logPath = path.join(__dirname, '..', 'notifications.log');
  if (!fs.existsSync(logPath)) return res.status(404).send("No log file found");

  const logs = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
  const filtered = logs.filter(line => {
    const match = line.match(/\[(.*?)\]/);
    if (!match) return true;
    const ts = new Date(match[1]).getTime();
    return !timestamps.includes(ts);
  });

  fs.writeFileSync(logPath, filtered.join('\n') + '\n');
  res.send("✅ Selected notifications deleted.");
});


// ============ Backup ============

app.get('/api/backup/:type', (req, res) => {
  const type = req.params.type;
  const isBackend = ['movies', 'series'].includes(type);
  const filePath = path.join(isBackend ? BACKEND_DIR : DATA_DIR, `${type}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  res.download(filePath);
});

app.get('/api/backup/zip', (req, res) => {
  res.attachment('backup.zip');
  const zip = archiver('zip');
  zip.pipe(res);

  ['admins.json', 'sessions.json'].forEach(f => zip.file(path.join(DATA_DIR, f), { name: f }));
  ['movies.json', 'series.json'].forEach(f => zip.file(path.join(BACKEND_DIR, f), { name: f }));

  zip.finalize();
});

// ================= Access Per Role =============
function getUserRole(username) {
  const admins = readJSON('admins.json');
  const user = admins.find(a => a.username === username);
  return user ? user.role : "unknown";
}


// ============ Delete Movies & Series ============

app.delete('/api/delete/movie', (req, res) => {
  const { id, deletedBy } = req.body;
  const role = getUserRole(deletedBy);

  if (role !== "owner") return res.status(403).send("❌ You are not authorized to delete movies.");

  let movies = readJSON('movies.json', 'backend');
  const movie = movies.find(movie => movie.id === id);
  if (!movie) return res.send("❌ Movie not found.");

  movies = movies.filter(m => m.id !== id);
  writeJSON('movies.json', movies, 'backend');

  logNotification(`Movie deleted: ${id} by ${deletedBy}`);
  res.send(`✅ Movie '${id}' deleted successfully.`);
});

app.delete('/api/delete/series', (req, res) => {
  const { id, deletedBy } = req.body;
  const role = getUserRole(deletedBy);

  if (role !== "owner") return res.status(403).send("❌ You are not authorized to delete series.");

  let series = readJSON('series.json', 'backend');
  if (!series[id]) return res.send("❌ Series not found.");

  delete series[id];
  writeJSON('series.json', series, 'backend');

  logNotification(`Series deleted: ${id} by ${deletedBy}`);
  res.send(`✅ Series '${id}' deleted successfully.`);
});

// ============ Start Server ============

app.listen(PORT, () => {
  console.log(`✅ MovieMania server running at http://localhost:${PORT}`);
});
