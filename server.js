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
    fileSize: 3 * 1024 * 1024 * 1024 // 3GB limit
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
    console.error('Video file not found:', filePath);
    return res.status(404).json({ error: 'Video not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Try to determine content type from query parameter (mimetype) if provided
  let contentType = req.query.type || 'video/mp4'; // default
  
  // If no type in query, try to determine from file extension (though files are stored as UUIDs)
  if (contentType === 'video/mp4') {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.mkv') {
      contentType = 'video/x-matroska';
    } else if (ext === '.webm') {
      contentType = 'video/webm';
    } else if (ext === '.avi') {
      contentType = 'video/x-msvideo';
    } else if (ext === '.mov') {
      contentType = 'video/quicktime';
    }
  }

  // Set CORS headers for video streaming
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

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
      'Content-Type': contentType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
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

// Get uploads storage info
app.get('/api/admin/storage', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    let totalSize = 0;
    const fileList = [];

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
      fileList.push({
        filename: file,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        created: stats.birthtime,
        modified: stats.mtime
      });
    });

    res.json({
      success: true,
      totalFiles: files.length,
      totalSize: totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      files: fileList.sort((a, b) => b.created - a.created) // Sort by newest first
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read storage info', message: error.message });
  }
});

// Clean up old files (older than X days, default 7 days)
app.delete('/api/admin/cleanup', (req, res) => {
  try {
    const daysOld = parseInt(req.query.days) || 7; // Default 7 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const files = fs.readdirSync(uploadsDir);
    let deletedCount = 0;
    let deletedSize = 0;
    const deletedFiles = [];

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      
      // Delete if file is older than cutoff date
      if (stats.birthtime < cutoffDate) {
        const fileSize = stats.size;
        fs.unlinkSync(filePath);
        deletedCount++;
        deletedSize += fileSize;
        deletedFiles.push({
          filename: file,
          size: fileSize,
          sizeFormatted: formatBytes(fileSize),
          age: Math.floor((Date.now() - stats.birthtime.getTime()) / (1000 * 60 * 60 * 24)) + ' days'
        });
      }
    });

    res.json({
      success: true,
      message: `Deleted ${deletedCount} file(s) older than ${daysOld} days`,
      deletedCount: deletedCount,
      deletedSize: deletedSize,
      deletedSizeFormatted: formatBytes(deletedSize),
      deletedFiles: deletedFiles
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cleanup files', message: error.message });
  }
});

// Delete all uploaded files (USE WITH CAUTION!)
app.delete('/api/admin/cleanup-all', (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir);
    let deletedCount = 0;
    let deletedSize = 0;

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      fs.unlinkSync(filePath);
      deletedCount++;
      deletedSize += fileSize;
    });

    res.json({
      success: true,
      message: `Deleted all ${deletedCount} file(s)`,
      deletedCount: deletedCount,
      deletedSize: deletedSize,
      deletedSizeFormatted: formatBytes(deletedSize)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete files', message: error.message });
  }
});

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

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
  // ALLOW FREE-FOR-ALL: Anyone can control (uploader or viewer)
  socket.on('video-state-update', (data) => {
    const { roomCode, videoState } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      console.log('⚠️ Cannot process video-state-update: room not found:', roomCode);
      return;
    }

    if (!room.currentVideo) {
      console.log('⚠️ Cannot process video-state-update: no video in room');
      return;
    }

    if (!videoState || !videoState.lastUpdatedBy) {
      console.log('⚠️ Cannot process video-state-update: invalid videoState:', videoState);
      return;
    }

    // Only update if this state is newer than what we have (allows same timestamp)
    const currentTimestamp = room.videoState?.timestamp || 0;
    const newTimestamp = videoState.timestamp || Date.now();
    
    if (newTimestamp >= currentTimestamp) {
      room.videoState = {
        ...videoState,
        lastUpdatedAt: new Date().toISOString()
      };

      // Broadcast to ALL others in room (not sender) - FREE FOR ALL CONTROL
      // Send in consistent format: { videoState: ... } to match client expectation
      const clientsInRoom = io.sockets.adapter.rooms.get(roomCode);
      const clientCount = clientsInRoom ? clientsInRoom.size : 0;
      
      console.log('📤 Broadcasting video-state-update to room:', roomCode);
      console.log('   Action:', videoState.action);
      console.log('   From user:', videoState.lastUpdatedBy);
      console.log('   Time:', videoState.currentTime);
      console.log('   IsPlaying:', videoState.isPlaying);
      console.log('   Clients in room:', clientCount);
      
      // Use io.to() to broadcast to all in room except sender (free-for-all control)
      socket.to(roomCode).emit('video-state-update', { videoState: room.videoState });
    } else {
      console.log('⚠️ Ignoring older state update:', newTimestamp, 'vs', currentTimestamp);
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

// Cleanup old files on server start (optional - uncomment if you want automatic cleanup)
// Uncomment the following to automatically delete files older than 30 days on startup
/*
setInterval(() => {
  try {
    const daysOld = 30; // Delete files older than 30 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const files = fs.readdirSync(uploadsDir);
    let deletedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.birthtime < cutoffDate) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    });
    
    if (deletedCount > 0) {
      console.log(`🧹 Auto-cleanup: Deleted ${deletedCount} old file(s)`);
    }
  } catch (error) {
    console.error('Auto-cleanup error:', error);
  }
}, 24 * 60 * 60 * 1000); // Run every 24 hours
*/

// Start server
server.listen(PORT, () => {
  console.log(`🎬 MovieHub Server running on port ${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`🌐 Access your webpage at: http://localhost:${PORT}`);
  console.log(`🧹 Storage management:`);
  console.log(`   - GET http://localhost:${PORT}/api/admin/storage - View storage info`);
  console.log(`   - DELETE http://localhost:${PORT}/api/admin/cleanup?days=7 - Delete files older than X days`);
  console.log(`   - DELETE http://localhost:${PORT}/api/admin/cleanup-all - Delete ALL files (use with caution!)`);
});

