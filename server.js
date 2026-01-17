const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Use environment variable PORT if available (for hosting services)
// Otherwise default to 3000 for local development
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
// Serve static files from root directory (HTML, CSS, JS)
app.use(express.static(__dirname));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Store with UUID as filename, but keep original name in metadata
    const fileId = uuidv4();
    const uniqueName = `${fileId}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024 // 2GB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  }
});

// Store room data in memory (in production, use a database)
const rooms = new Map();
const users = new Map();

// Room management
function getOrCreateRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      code: roomCode,
      users: [],
      messages: [],
      currentVideo: null,
      videoState: null,
      createdAt: new Date().toISOString()
    });
  }
  return rooms.get(roomCode);
}

// API Routes

// Serve the main webpage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Upload video file
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const fileId = req.file.filename; // This is the UUID we set as filename
  
  const videoData = {
    id: fileId,
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
    path: req.file.path,
    uploadedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    video: {
      id: videoData.id,
      name: videoData.originalName,
      size: videoData.size,
      type: videoData.mimetype,
      filename: videoData.filename
    }
  });
});

// Stream video file
app.get('/api/video/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    // Handle range requests for video streaming
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Get room data
app.get('/api/room/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  const room = rooms.get(roomCode);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    code: room.code,
    userCount: room.users.length,
    currentVideo: room.currentVideo,
    createdAt: room.createdAt
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room
  socket.on('join-room', (data) => {
    const { roomCode, userId, nickname } = data;
    const room = getOrCreateRoom(roomCode);

    // Add user to room
    const user = {
      id: userId,
      socketId: socket.id,
      nickname: nickname || 'Guest',
      joinedAt: new Date().toISOString()
    };

    // Remove user if already exists
    room.users = room.users.filter(u => u.id !== userId);
    room.users.push(user);
    users.set(socket.id, { userId, roomCode });

    socket.join(roomCode);

    // Send current room state to new user
    socket.emit('room-state', {
      users: room.users,
      messages: room.messages.slice(-50), // Last 50 messages
      currentVideo: room.currentVideo,
      videoState: room.videoState
    });

    // Notify others in room
    socket.to(roomCode).emit('user-joined', {
      user: user,
      userCount: room.users.length
    });

    // Broadcast updated user count
    io.to(roomCode).emit('user-count-update', {
      count: room.users.length
    });
  });

  // Leave room
  socket.on('leave-room', (data) => {
    const { roomCode, userId } = data;
    const room = rooms.get(roomCode);

    if (room) {
      room.users = room.users.filter(u => u.id !== userId);
      users.delete(socket.id);
      socket.leave(roomCode);

      // Notify others
      socket.to(roomCode).emit('user-left', {
        userId: userId,
        userCount: room.users.length
      });

      // Broadcast updated user count
      io.to(roomCode).emit('user-count-update', {
        count: room.users.length
      });

      // Delete room if empty
      if (room.users.length === 0) {
        rooms.delete(roomCode);
      }
    }
  });

  // Send chat message
  socket.on('chat-message', (data) => {
    const { roomCode, userId, nickname, message } = data;
    const room = rooms.get(roomCode);

    if (room) {
      const messageObj = {
        id: uuidv4(),
        userId: userId,
        nickname: nickname,
        message: message,
        timestamp: new Date().toISOString()
      };

      room.messages.push(messageObj);
      
      // Keep only last 100 messages
      if (room.messages.length > 100) {
        room.messages = room.messages.slice(-100);
      }

      io.to(roomCode).emit('chat-message', messageObj);
    }
  });

  // Video loaded/shared
  socket.on('video-loaded', (data) => {
    const { roomCode, video } = data;
    const room = rooms.get(roomCode);

    if (room) {
      room.currentVideo = video;
      room.videoState = {
        videoId: video.id,
        currentTime: 0,
        isPlaying: false,
        lastUpdatedBy: data.userId,
        lastUpdatedAt: new Date().toISOString()
      };

      socket.to(roomCode).emit('video-loaded', {
        video: video,
        userId: data.userId
      });
    }
  });

  // Video state update (play, pause, seek, timeupdate)
  socket.on('video-state-update', (data) => {
    const { roomCode, videoState } = data;
    const room = rooms.get(roomCode);

    if (room && room.currentVideo) {
      room.videoState = {
        ...videoState,
        lastUpdatedAt: new Date().toISOString()
      };

      // Broadcast to others in room (not sender)
      socket.to(roomCode).emit('video-state-update', room.videoState);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const userData = users.get(socket.id);
    if (userData) {
      const { userId, roomCode } = userData;
      const room = rooms.get(roomCode);

      if (room) {
        room.users = room.users.filter(u => u.id !== userId);
        users.delete(socket.id);

        socket.to(roomCode).emit('user-left', {
          userId: userId,
          userCount: room.users.length
        });

        io.to(roomCode).emit('user-count-update', {
          count: room.users.length
        });

        if (room.users.length === 0) {
          rooms.delete(roomCode);
        }
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

// Serve the main HTML file for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`🎬 MovieHub Server running on port ${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`🌐 Access your webpage at: http://localhost:${PORT}`);
});

