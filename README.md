# MovieHub - Synchronized Video Watching Platform

A web application for watching videos together in real-time with synchronized playback, chat, and subtitle support.

## Features

- 🎬 **Synchronized Video Playback**: Watch videos together with synced play/pause/seek
- 💬 **Real-time Chat**: Chat with others in the room
- 📝 **Subtitle Support**: Upload and display subtitles (SRT, VTT)
- 👥 **Room Management**: Create or join rooms with shareable links
- 📤 **File Sharing**: One person uploads, everyone can watch

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   
   For development with auto-reload:
   ```bash
   npm run dev
   ```

3. **Open the webpage:**
   - Open `index.html` in your browser
   - Or serve it through the server (the server serves static files from `public/` folder)

### Server Configuration

The server runs on port 3000 by default. You can change this by setting the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Project Structure

```
movie webpage/
├── index.html          # Main webpage
├── styles.css          # Styles
├── script.js           # Frontend JavaScript (needs update for backend)
├── server.js           # Backend server
├── package.json        # Dependencies
├── uploads/            # Uploaded video files (created automatically)
└── README.md          # This file
```

## API Endpoints

### POST `/api/upload`
Upload a video file
- Body: multipart/form-data with `video` field
- Returns: Video metadata

### GET `/api/video/:filename`
Stream video file
- Supports HTTP range requests for video streaming

### GET `/api/room/:roomCode`
Get room information
- Returns: Room data including user count and current video

## WebSocket Events

### Client → Server
- `join-room`: Join a room
- `leave-room`: Leave a room
- `chat-message`: Send a chat message
- `video-loaded`: Notify when video is loaded
- `video-state-update`: Update video playback state

### Server → Client
- `room-state`: Current room state when joining
- `user-joined`: User joined notification
- `user-left`: User left notification
- `user-count-update`: Updated user count
- `chat-message`: New chat message
- `video-loaded`: Video loaded by someone
- `video-state-update`: Video state update from others

## Deployment

### Local Development
1. Run `npm start`
2. Open `index.html` in browser
3. Update frontend to connect to `http://localhost:3000`

### Production Deployment
1. Set up environment variables
2. Use a process manager like PM2
3. Configure reverse proxy (nginx)
4. Set up file storage (consider cloud storage for large files)

## Notes

- Video files are stored locally in the `uploads/` directory
- For production, consider using cloud storage (AWS S3, Google Cloud Storage)
- The server stores room data in memory - use a database for persistence
- File size limit is set to 2GB (configurable in server.js)

## License

ISC

