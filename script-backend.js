// This file contains the backend integration code
// Add these functions to your existing script.js file

// ============ SERVER CONNECTION ============

// Connect to backend server
function connectToServer() {
    if (typeof io === 'undefined') {
        console.error('Socket.io not loaded. Make sure to include the Socket.io script in HTML.');
        return;
    }

    socket = io(SERVER_URL);

    socket.on('connect', () => {
        isConnected = true;
        console.log('Connected to server');
        
        // If already in a room, rejoin
        if (currentRoom) {
            joinRoomSocket(currentRoom);
        }
    });

    socket.on('disconnect', () => {
        isConnected = false;
        console.log('Disconnected from server');
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        alert('Cannot connect to server. Make sure the server is running on ' + SERVER_URL);
    });

    // Room state received when joining
    socket.on('room-state', (data) => {
        roomUsers = data.users || [];
        chatMessages = data.messages || [];
        
        updateUserCount();
        updateChatDisplay();
        
        // If there's a video in the room, load it
        if (data.currentVideo && !currentVideo) {
            loadVideoFromServer(data.currentVideo);
        }
        
        // Sync video state if available
        if (data.videoState) {
            setTimeout(() => {
                applyVideoState(data.videoState);
            }, 500);
        }
    });

    // User joined
    socket.on('user-joined', (data) => {
        roomUsers = data.users || [];
        updateUserCount();
        addSystemMessage(`${data.user.nickname} joined the room`);
    });

    // User left
    socket.on('user-left', (data) => {
        roomUsers = roomUsers.filter(u => u.id !== data.userId);
        updateUserCount();
    });

    // User count update
    socket.on('user-count-update', (data) => {
        updateUserCount();
    });

    // Chat message
    socket.on('chat-message', (messageObj) => {
        chatMessages.push(messageObj);
        updateChatDisplay();
    });

    // Video loaded by someone else
    socket.on('video-loaded', (data) => {
        if (data.userId !== userId) {
            loadVideoFromServer(data.video);
            addSystemMessage(`${data.user?.nickname || 'Someone'} loaded video: ${data.video.name}`);
        }
    });

    // Video state update from others
    socket.on('video-state-update', (videoState) => {
        if (videoState.lastUpdatedBy !== userId) {
            applyVideoState(videoState);
        }
    });
}

// Join room via WebSocket
function joinRoomSocket(roomCode) {
    if (!socket || !isConnected) {
        console.error('Not connected to server');
        return;
    }

    socket.emit('join-room', {
        roomCode: roomCode,
        userId: userId,
        nickname: userNickname
    });
}

// Leave room via WebSocket
function leaveRoomSocket() {
    if (socket && isConnected && currentRoom) {
        socket.emit('leave-room', {
            roomCode: currentRoom,
            userId: userId
        });
    }
}

// ============ UPDATED ROOM FUNCTIONS ============

// Create a new room (updated for backend)
function createRoom() {
    const roomCode = generateRoomCode();
    currentRoom = roomCode;
    
    // Update URL
    updateRoomURL(roomCode);
    
    // Join room via WebSocket
    if (socket && isConnected) {
        joinRoomSocket(roomCode);
    }
    
    // Update UI
    showRoomInterface();
    addSystemMessage(`${userNickname} created the room`);
    
    // Update room status
    updateRoomStatus();
}

// Join an existing room (updated for backend)
function joinRoom() {
    const roomCodeInput = document.getElementById('roomCodeInput');
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    
    if (!roomCode || roomCode.length !== 6) {
        alert('Please enter a valid 6-character room code');
        return;
    }
    
    currentRoom = roomCode;
    
    // Update URL
    updateRoomURL(roomCode);
    
    // Join room via WebSocket
    if (socket && isConnected) {
        joinRoomSocket(roomCode);
    } else {
        alert('Not connected to server. Please wait a moment and try again.');
        return;
    }
    
    // Update UI
    showRoomInterface();
    
    // Update room status
    updateRoomStatus();
    
    roomCodeInput.value = '';
}

// Leave room (updated for backend)
function leaveRoom() {
    if (!currentRoom) return;
    
    // Leave via WebSocket
    leaveRoomSocket();
    
    // Stop video sync
    isSyncing = false;
    
    // Clear room data
    const roomCodeToLeave = currentRoom;
    currentRoom = null;
    roomUsers = [];
    chatMessages = [];
    lastVideoState = null;
    shownNotifications.clear();
    
    // Clear current video if playing
    if (currentVideo) {
        const videoPlayer = document.getElementById('videoPlayer');
        const videoSource = document.getElementById('videoSource');
        const videoInfo = document.getElementById('videoInfo');
        const fileInfo = document.getElementById('fileInfo');
        
        if (videoPlayer && videoSource) {
            videoSource.src = '';
            videoPlayer.load();
        }
        
        if (videoInfo) {
            videoInfo.innerHTML = '<p>No video loaded. Please upload a video file to get started.</p>';
        }
        
        if (fileInfo) {
            fileInfo.classList.remove('active');
            fileInfo.innerHTML = '';
        }
        
        currentVideo = null;
    }
    
    // Clear subtitles
    removeSubtitle();
    
    // Clear URL
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.pushState({}, '', url);
    
    // Update UI - show create/join room interface
    const roomActions = document.getElementById('roomActions');
    const roomActive = document.getElementById('roomActive');
    const roomStatus = document.getElementById('roomStatus');
    const userInfo = document.getElementById('userInfo');
    const chatMessagesDiv = document.getElementById('chatMessages');
    
    if (roomActions) roomActions.style.display = 'flex';
    if (roomActive) roomActive.style.display = 'none';
    if (roomStatus) roomStatus.style.display = 'none';
    if (userInfo) userInfo.style.display = 'none';
    if (chatMessagesDiv) chatMessagesDiv.innerHTML = '';
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Clear room code input
    const roomCodeInput = document.getElementById('roomCodeInput');
    if (roomCodeInput) {
        roomCodeInput.value = '';
    }
}

// ============ UPDATED CHAT FUNCTIONS ============

// Send message (updated for backend)
function sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    if (!currentRoom) {
        alert('Please join or create a room first!');
        return;
    }
    
    if (!socket || !isConnected) {
        alert('Not connected to server. Please wait a moment and try again.');
        return;
    }
    
    // Send via WebSocket
    socket.emit('chat-message', {
        roomCode: currentRoom,
        userId: userId,
        nickname: userNickname,
        message: message
    });
    
    // Clear input
    chatInput.value = '';
}

// ============ UPDATED VIDEO FUNCTIONS ============

// Load video from server (when someone else uploads)
function loadVideoFromServer(videoData) {
    // Check if we already have this video
    const existingVideo = uploadedVideos.find(v => v.id === videoData.id);
    
    if (existingVideo) {
        loadVideo(existingVideo, false);
        return;
    }
    
    // Create video object with server URL
    const videoObject = {
        id: videoData.id,
        name: videoData.name,
        size: videoData.size || 'Unknown',
        type: videoData.type || 'video/mp4',
        url: `${SERVER_URL}/api/video/${videoData.filename || videoData.id}`,
        filename: videoData.filename || videoData.id,
        uploadDate: new Date().toLocaleDateString(),
        fromServer: true
    };
    
    // Add to uploaded videos
    uploadedVideos.push(videoObject);
    saveVideosToStorage();
    
    // Load in player
    loadVideo(videoObject, false);
    
    // Update library
    updateMoviesLibrary();
}

// Update video state in room (updated for backend)
function updateVideoStateInRoom(action, time = null) {
    if (!currentRoom || !socket || !isConnected) return;
    
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !currentVideo) return;
    
    const newTime = time !== null ? time : videoPlayer.currentTime;
    
    const videoState = {
        videoId: currentVideo.id,
        currentTime: newTime,
        isPlaying: action === 'play' || (action === 'timeupdate' && !videoPlayer.paused),
        lastUpdatedBy: userId,
        action: action
    };
    
    lastVideoState = {
        ...videoState,
        timestamp: Date.now()
    };
    
    // Send via WebSocket
    socket.emit('video-state-update', {
        roomCode: currentRoom,
        videoState: videoState
    });
}

// Share video to room (updated for backend)
function shareVideoToRoom(videoObject) {
    if (!currentRoom || !socket || !isConnected) return;
    
    // Send video info via WebSocket
    socket.emit('video-loaded', {
        roomCode: currentRoom,
        userId: userId,
        video: {
            id: videoObject.id,
            name: videoObject.name,
            size: videoObject.size,
            type: videoObject.type,
            filename: videoObject.filename || videoObject.id
        }
    });
    
    // Update room status
    updateRoomStatus();
    
    // Add system message
    addSystemMessage(`${userNickname} loaded video: ${videoObject.name}`);
}

// Remove startRoomPolling - no longer needed with WebSocket
// The WebSocket handles real-time updates automatically

