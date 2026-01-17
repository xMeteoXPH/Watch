// Store uploaded videos in memory
let uploadedVideos = [];
let currentVideo = null;

// Subtitle management
let currentSubtitles = [];
let subtitleFileName = null;

// Room and chat management
let currentRoom = null;
let userId = null;
let userNickname = 'Guest';
let chatMessages = [];
let roomUsers = [];

// Backend server connection
const SERVER_URL = 'https://watch-production-e219.up.railway.app';
let socket = null;
let isConnected = false;

// Video sync management
let isSyncing = false; // Prevents sync loops
let lastVideoState = null; // Last known video state
let videoSyncInterval = null;
let shownNotifications = new Set(); // Track which video notifications have been shown

// Generate unique user ID
function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Generate room code
function generateRoomCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Load saved videos from localStorage when page loads
document.addEventListener('DOMContentLoaded', function() {
    userId = localStorage.getItem('userId') || generateUserId();
    localStorage.setItem('userId', userId);
    
    userNickname = localStorage.getItem('userNickname') || 'Guest';
    updateUserDisplay();
    
    // Connect to backend server
    connectToServer();
    
    // Check if joining via room link
    checkRoomFromURL();
    
    // Load saved videos if library section exists
    if (document.getElementById('moviesContainer')) {
        loadSavedVideos();
    }
    
    setupSmoothScroll();
});

// Function to scroll to video player
function scrollToPlayer() {
    const watchSection = document.getElementById('watch');
    watchSection.scrollIntoView({ behavior: 'smooth' });
}

// Setup drag and drop functionality
function setupDragAndDrop() {
    const uploadBox = document.getElementById('uploadBox');
    const fileInput = document.getElementById('fileInput');

    // Drag and drop events
    uploadBox.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadBox.classList.add('dragover');
    });

    uploadBox.addEventListener('dragleave', function() {
        uploadBox.classList.remove('dragover');
    });

    uploadBox.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadBox.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    // Click to upload
    uploadBox.addEventListener('click', function() {
        fileInput.click();
    });
}

// Handle file selection from input
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        handleFileUpload(file);
    }
}

// Handle file upload
function handleFileUpload(file) {
    // Check if file is a video
    if (!file.type.startsWith('video/')) {
        alert('Please upload a video file (MP4, MKV, etc.)');
        return;
    }

    // Create object URL for the video
    const videoURL = URL.createObjectURL(file);

    // Create video object
    const videoObject = {
        id: Date.now().toString(),
        name: file.name,
        size: formatFileSize(file.size),
        type: file.type,
        url: videoURL,
        file: file,
        uploadDate: new Date().toLocaleDateString()
    };

    // Add to uploaded videos array
    uploadedVideos.push(videoObject);
    
    // Save to localStorage (as metadata only, not the actual file)
    saveVideosToStorage();

    // Display file info
    displayFileInfo(videoObject);

    // Load the video in player
    loadVideo(videoObject);

    // Update movies library
    updateMoviesLibrary();

    // Reset file input
    document.getElementById('fileInput').value = '';
}

// Display file information
function displayFileInfo(videoObject) {
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.innerHTML = `
        <div class="file-info-item">
            <span class="file-info-label">File Name:</span>
            <span class="file-info-value">${videoObject.name}</span>
        </div>
        <div class="file-info-item">
            <span class="file-info-label">File Size:</span>
            <span class="file-info-value">${videoObject.size}</span>
        </div>
        <div class="file-info-item">
            <span class="file-info-label">File Type:</span>
            <span class="file-info-value">${videoObject.type}</span>
        </div>
        <div class="file-info-item">
            <span class="file-info-label">Upload Date:</span>
            <span class="file-info-value">${videoObject.uploadDate}</span>
        </div>
    `;
    fileInfo.classList.add('active');
}

// Load video into player
function loadVideo(videoObject, syncToRoom = true) {
    const videoPlayer = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
    const videoInfo = document.getElementById('videoInfo');
    const customControls = document.getElementById('customControls');

    if (!videoPlayer || !videoSource) return;

    videoSource.src = videoObject.url;
    // Set the correct MIME type for the video source
    if (videoObject.type) {
        videoSource.type = videoObject.type;
    } else {
        // Default to mp4 if type not specified
        videoSource.type = 'video/mp4';
    }
    videoPlayer.load();

    videoInfo.innerHTML = `
        <p><strong>Now Playing:</strong> ${videoObject.name}</p>
    `;

    currentVideo = videoObject;

    // Show custom controls when video metadata is loaded
    const showControls = () => {
        if (customControls) {
            customControls.style.display = 'flex';
        }
        updatePlayPauseButton();
    };

    // Remove any existing listeners to avoid duplicates
    videoPlayer.removeEventListener('loadedmetadata', showControls);
    
    // Add listener for when metadata loads
    videoPlayer.addEventListener('loadedmetadata', showControls, { once: true });
    
    // If video already has metadata, show controls immediately
    if (videoPlayer.readyState >= 1) {
        setTimeout(showControls, 100);
    }

    // If in a room and syncToRoom is true, share video with room
    if (currentRoom && syncToRoom) {
        shareVideoToRoom(videoObject);
    }

    // Scroll to player
    videoPlayer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Update movies library display
function updateMoviesLibrary() {
    const moviesContainer = document.getElementById('moviesContainer');
    moviesContainer.innerHTML = '';

    if (uploadedVideos.length === 0) {
        moviesContainer.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #666;">
                <p style="font-size: 1.2rem;">No videos uploaded yet. Upload your first video to get started!</p>
            </div>
        `;
        return;
    }

    uploadedVideos.forEach(video => {
        const movieCard = createMovieCard(video);
        moviesContainer.appendChild(movieCard);
    });
}

// Create movie card element
function createMovieCard(video) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    
    // Get video icon based on file type
    const icon = video.type.includes('mp4') ? '🎬' : '🎥';
    
    card.innerHTML = `
        <div class="movie-poster">${icon}</div>
        <div class="play-overlay">▶</div>
        <button class="delete-btn" onclick="deleteVideo('${video.id}', event)">×</button>
        <div class="movie-info">
            <h3 class="movie-title" title="${video.name}">${truncateFileName(video.name, 30)}</h3>
            <p class="movie-year">${video.size}</p>
            <span class="movie-rating">📅 ${video.uploadDate}</span>
        </div>
    `;
    
    // Add click event to play video
    card.addEventListener('click', function(e) {
        // Don't trigger if clicking delete button
        if (!e.target.classList.contains('delete-btn')) {
            loadVideo(video);
            scrollToPlayer();
        }
    });
    
    return card;
}

// Truncate file name if too long
function truncateFileName(name, maxLength) {
    if (name.length <= maxLength) return name;
    const extension = name.substring(name.lastIndexOf('.'));
    const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
    return nameWithoutExt.substring(0, maxLength - extension.length - 3) + '...' + extension;
}

// Delete video from library
function deleteVideo(videoId, event) {
    event.stopPropagation(); // Prevent card click event
    
    if (confirm('Are you sure you want to remove this video from your library?')) {
        // Find video index
        const videoIndex = uploadedVideos.findIndex(v => v.id === videoId);
        
        if (videoIndex !== -1) {
            // Revoke object URL to free memory
            URL.revokeObjectURL(uploadedVideos[videoIndex].url);
            
            // Remove from array
            uploadedVideos.splice(videoIndex, 1);
            
            // Save to storage
            saveVideosToStorage();
            
            // If deleted video was currently playing, clear player
            if (currentVideo && currentVideo.id === videoId) {
                const videoPlayer = document.getElementById('videoPlayer');
                const videoSource = document.getElementById('videoSource');
                const videoInfo = document.getElementById('videoInfo');
                
                videoSource.src = '';
                videoPlayer.load();
                videoInfo.innerHTML = '<p>No video loaded. Please upload a video file to get started.</p>';
                document.getElementById('fileInfo').classList.remove('active');
                currentVideo = null;
            }
            
            // Update library display
            updateMoviesLibrary();
        }
    }
}

// Save videos to localStorage (metadata only)
function saveVideosToStorage() {
    // Store only metadata, not the actual file
    const videosMetadata = uploadedVideos.map(v => ({
        id: v.id,
        name: v.name,
        size: v.size,
        type: v.type,
        uploadDate: v.uploadDate
    }));
    
    localStorage.setItem('uploadedVideos', JSON.stringify(videosMetadata));
}

// Load saved videos from localStorage
function loadSavedVideos() {
    // Note: We can't restore the actual files from localStorage
    // This would require the user to re-upload files
    // For now, we'll just show the upload interface
    updateMoviesLibrary();
}

// Setup smooth scrolling for navigation links
function setupSmoothScroll() {
    const navLinks = document.querySelectorAll('.nav-links a');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            if (href.startsWith('#')) {
                e.preventDefault();
                const targetId = href.substring(1);
                const targetSection = document.getElementById(targetId);
                
                if (targetSection) {
                    targetSection.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });
}

// Add scroll effect to header
window.addEventListener('scroll', function() {
    const header = document.querySelector('header');
    if (window.scrollY > 100) {
        header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.2)';
    } else {
        header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
    }
});

// ============ ROOM MANAGEMENT ============

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
        // Don't show alert immediately, try to reconnect
        setTimeout(() => {
            if (!isConnected) {
                console.log('Retrying connection...');
                socket.connect();
            }
        }, 2000);
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

// Create a new room
function createRoom() {
    const roomCode = generateRoomCode();
    currentRoom = roomCode;
    
    // Update URL
    updateRoomURL(roomCode);
    
    // Try to connect if not connected
    if (!socket) {
        connectToServer();
    }
    
    // Wait for connection, then join room
    if (!isConnected) {
        let attempts = 0;
        const checkConnection = setInterval(() => {
            attempts++;
            if (isConnected) {
                clearInterval(checkConnection);
                joinRoomSocket(roomCode);
            } else if (attempts >= 15) {
                clearInterval(checkConnection);
                console.warn('Not connected, but proceeding anyway');
            }
        }, 200);
    } else {
        joinRoomSocket(roomCode);
    }
    
    // Update UI
    showRoomInterface();
    addSystemMessage(`${userNickname} created the room`);
    
    // Update room status
    updateRoomStatus();
}

// Join an existing room
function joinRoom() {
    const roomCodeInput = document.getElementById('roomCodeInput');
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    
    if (!roomCode || roomCode.length !== 6) {
        alert('Please enter a valid 6-character room code');
        return;
    }
    
    // Wait for connection if not connected yet
    if (!socket || !isConnected) {
        // Try to connect if socket doesn't exist
        if (!socket) {
            connectToServer();
        }
        
        // Wait up to 3 seconds for connection
        let attempts = 0;
        const checkConnection = setInterval(() => {
            attempts++;
            if (isConnected) {
                clearInterval(checkConnection);
                proceedJoinRoom(roomCode);
                roomCodeInput.value = '';
            } else if (attempts >= 15) { // 3 seconds (15 * 200ms)
                clearInterval(checkConnection);
                alert('Cannot connect to server. Make sure the server is running on ' + SERVER_URL);
            }
        }, 200);
        return;
    }
    
    proceedJoinRoom(roomCode);
    roomCodeInput.value = '';
}

// Helper function to proceed with joining room
function proceedJoinRoom(roomCode) {
    currentRoom = roomCode;
    
    // Update URL
    updateRoomURL(roomCode);
    
    // Join room via WebSocket
    joinRoomSocket(roomCode);
    
    // Update UI
    showRoomInterface();
    
    // Update room status
    updateRoomStatus();
}

// Check room from URL on page load
function checkRoomFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    
    if (roomCode) {
        // Join the room
        const roomCodeInput = document.getElementById('roomCodeInput');
        if (roomCodeInput) {
            roomCodeInput.value = roomCode;
            joinRoom();
        }
    }
}

// Update room URL
function updateRoomURL(roomCode) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomCode);
    window.history.pushState({}, '', url);
}

// Show room interface
function showRoomInterface() {
    document.getElementById('roomActions').style.display = 'none';
    document.getElementById('roomActive').style.display = 'block';
    document.getElementById('roomCodeDisplay').textContent = currentRoom;
    document.getElementById('userInfo').style.display = 'flex';
    
    // Setup video functionality when room is shown
    const fileInput = document.getElementById('fileInput');
    const videoPlayer = document.getElementById('videoPlayer');
    
    if (fileInput && !fileInput.hasAttribute('data-setup')) {
        setupDragAndDrop();
        fileInput.setAttribute('data-setup', 'true');
    }
    
    if (videoPlayer && !videoPlayer.hasAttribute('data-setup')) {
        setupVideoSync();
        videoPlayer.setAttribute('data-setup', 'true');
    }
    
    // Load room data
    loadRoomData();
    updateUserCount();
    updateChatDisplay();
}

// Load room data (no longer needed with WebSocket, but kept for compatibility)
function loadRoomData() {
    // WebSocket handles all room data updates automatically
    // This function is kept for compatibility but does nothing
}

// Leave room
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
    
    // Clear URL
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.pushState({}, '', url);
    
    // Clear current video if playing
    if (currentVideo) {
        const videoPlayer = document.getElementById('videoPlayer');
        const videoSource = document.getElementById('videoSource');
        const videoInfo = document.getElementById('videoInfo');
        const fileInfo = document.getElementById('fileInfo');
        const customControls = document.getElementById('customControls');
        
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
        
        // Hide custom controls
        if (customControls) {
            customControls.style.display = 'none';
        }
        
        currentVideo = null;
    }
    
    // Clear subtitles
    removeSubtitle();
    
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
    
    // Scroll to top to show the create room interface
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Clear room code input if it exists
    const roomCodeInput = document.getElementById('roomCodeInput');
    if (roomCodeInput) {
        roomCodeInput.value = '';
    }
}

// Load video from server (when someone else uploads)
function loadVideoFromServer(videoData) {
    console.log('Loading video from server:', videoData);
    
    // Check if we already have this video
    const existingVideo = uploadedVideos.find(v => v.id === videoData.id);
    
    let videoObject;
    
    if (existingVideo) {
        videoObject = existingVideo;
        console.log('Using existing video:', videoObject);
    } else {
        // Create video object with server URL
        // Include the MIME type as a query parameter so server knows the content type
        const videoMimeType = videoData.type || 'video/mp4';
        const videoUrl = `${SERVER_URL}/api/video/${videoData.filename || videoData.id}?type=${encodeURIComponent(videoMimeType)}`;
        console.log('Creating new video object with URL:', videoUrl);
        console.log('Video MIME type:', videoMimeType);
        
        videoObject = {
            id: videoData.id,
            name: videoData.name,
            size: videoData.size || 'Unknown',
            type: videoMimeType,
            url: videoUrl,
            filename: videoData.filename || videoData.id,
            uploadDate: new Date().toLocaleDateString(),
            fromServer: true
        };
        
        // Add to uploaded videos
        uploadedVideos.push(videoObject);
        saveVideosToStorage();
    }
    
    // Load in player - this will show the video and controls
    loadVideo(videoObject, false);
    
    // Ensure custom controls are shown for other users
    const videoPlayer = document.getElementById('videoPlayer');
    const customControls = document.getElementById('customControls');
    
    if (videoPlayer && customControls) {
        // Show controls when video metadata is loaded
        const showControlsOnLoad = () => {
            if (customControls) {
                customControls.style.display = 'flex';
            }
            updatePlayPauseButton();
        };
        
        // Add error handler to see if video fails to load
        videoPlayer.addEventListener('error', (e) => {
            console.error('Video load error:', e);
            console.error('Video src:', videoPlayer.src);
            console.error('Video readyState:', videoPlayer.readyState);
            const error = videoPlayer.error;
            if (error) {
                console.error('Video error code:', error.code);
                console.error('Video error message:', error.message);
            }
        }, { once: true });
        
        // Try to show controls immediately
        setTimeout(() => {
            if (videoPlayer.readyState >= 1) {
                // Video already has metadata
                showControlsOnLoad();
            }
        }, 200);
        
        // Also listen for metadata load
        videoPlayer.addEventListener('loadedmetadata', () => {
            console.log('Video metadata loaded for other user');
            showControlsOnLoad();
        }, { once: true });
        
        // Listen for when video can start playing
        videoPlayer.addEventListener('canplay', () => {
            console.log('Video can play for other user');
            if (customControls) {
                customControls.style.display = 'flex';
            }
            updatePlayPauseButton();
        }, { once: true });
        
        // Fallback: check again after a delay to ensure controls are visible
        setTimeout(() => {
            if (customControls && customControls.style.display !== 'flex' && currentVideo) {
                customControls.style.display = 'flex';
                updatePlayPauseButton();
            }
        }, 1000);
    }
    
    // Update library
    updateMoviesLibrary();
}

// Update user count display
function updateUserCount() {
    const userCount = roomUsers.length;
    document.getElementById('userCount').textContent = userCount;
    document.getElementById('chatUserCount').textContent = userCount + ' online';
    
    if (currentRoom) {
        document.getElementById('roomStatusUsers').textContent = userCount;
    }
}

// Update room status in watch section
function updateRoomStatus() {
    if (currentRoom) {
        const roomStatus = document.getElementById('roomStatus');
        const roomStatusCode = document.getElementById('roomStatusCode');
        const syncIndicator = document.getElementById('syncIndicator');
        
        if (roomStatus) {
            roomStatus.style.display = 'block';
        }
        
        if (roomStatusCode) {
            roomStatusCode.textContent = currentRoom;
        }
        
        updateUserCount();
        
        // Show sync indicator if video is shared
        const roomDataStr = localStorage.getItem('room_' + currentRoom);
        if (roomDataStr && syncIndicator) {
            const roomData = JSON.parse(roomDataStr);
            if (roomData.currentVideo && currentVideo && roomData.currentVideo.id === currentVideo.id) {
                syncIndicator.style.display = 'block';
            } else {
                syncIndicator.style.display = 'none';
            }
        }
    } else {
        const roomStatus = document.getElementById('roomStatus');
        if (roomStatus) {
            roomStatus.style.display = 'none';
        }
    }
}

// ============ CHAT MANAGEMENT ============

// Send message
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

// Handle chat input key press
function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// Add system message
function addSystemMessage(message) {
    const messageObj = {
        id: Date.now().toString(),
        userId: 'system',
        nickname: 'System',
        message: message,
        timestamp: new Date().toISOString(),
        isSystem: true
    };
    
    const roomDataStr = localStorage.getItem('room_' + currentRoom);
    if (roomDataStr) {
        const roomData = JSON.parse(roomDataStr);
        roomData.messages = roomData.messages || [];
        roomData.messages.push(messageObj);
        localStorage.setItem('room_' + currentRoom, JSON.stringify(roomData));
    }
    
    chatMessages.push(messageObj);
    updateChatDisplay();
}

// Update chat display
function updateChatDisplay() {
    const chatMessagesDiv = document.getElementById('chatMessages');
    chatMessagesDiv.innerHTML = '';
    
    chatMessages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        if (msg.isSystem) {
            messageDiv.className += ' system';
            messageDiv.style.cssText = 'align-self: center; background: #e8ebff; color: #667eea; font-style: italic; text-align: center;';
        } else if (msg.userId === userId) {
            messageDiv.className += ' own';
        } else {
            messageDiv.className += ' other';
        }
        
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="message-author">${msg.nickname}</div>
            <div class="message-text">${escapeHtml(msg.message)}</div>
            <div class="message-time">${time}</div>
        `;
        
        chatMessagesDiv.appendChild(messageDiv);
    });
    
    // Scroll to bottom
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ NICKNAME MANAGEMENT ============

// Show nickname modal
function showNicknameModal() {
    document.getElementById('nicknameModal').style.display = 'flex';
    document.getElementById('nicknameInput').value = userNickname;
    document.getElementById('nicknameInput').focus();
}

// Close nickname modal
function closeNicknameModal() {
    document.getElementById('nicknameModal').style.display = 'none';
}

// Save nickname
function saveNickname() {
    const nicknameInput = document.getElementById('nicknameInput');
    const newNickname = nicknameInput.value.trim();
    
    if (!newNickname) {
        alert('Please enter a nickname');
        return;
    }
    
    if (newNickname.length > 20) {
        alert('Nickname must be 20 characters or less');
        return;
    }
    
    const oldNickname = userNickname;
    userNickname = newNickname;
    
    // Save to localStorage
    localStorage.setItem('userNickname', userNickname);
    
    // Update display
    updateUserDisplay();
    
    // Update in room if in one
    if (currentRoom) {
        const roomDataStr = localStorage.getItem('room_' + currentRoom);
        if (roomDataStr) {
            const roomData = JSON.parse(roomDataStr);
            const userIndex = roomData.users.findIndex(u => u.id === userId);
            if (userIndex !== -1) {
                roomData.users[userIndex].nickname = userNickname;
                localStorage.setItem('room_' + currentRoom, JSON.stringify(roomData));
            }
            
            // Add system message about nickname change
            addSystemMessage(`${oldNickname} changed their nickname to ${userNickname}`);
        }
    }
    
    closeNicknameModal();
}

// Update user display
function updateUserDisplay() {
    document.getElementById('userNickname').textContent = userNickname;
}

// ============ SHARE LINK ============

// Show share modal
function shareRoomLink() {
    if (!currentRoom) {
        alert('Please create or join a room first!');
        return;
    }
    
    // Use index.html for share links
    const shareLink = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'index.html?room=' + currentRoom;
    const shareLinkInput = document.getElementById('shareLinkInput');
    const shareModal = document.getElementById('shareModal');
    
    if (shareLinkInput) {
        shareLinkInput.value = shareLink;
    }
    if (shareModal) {
        shareModal.style.display = 'flex';
    }
}

// Close share modal
function closeShareModal() {
    document.getElementById('shareModal').style.display = 'none';
}

// Copy share link
function copyShareLink() {
    const shareLinkInput = document.getElementById('shareLinkInput');
    shareLinkInput.select();
    document.execCommand('copy');
    
    // Show feedback
    const copyBtn = document.querySelector('.copy-btn');
    const originalText = copyBtn.textContent;
    copyBtn.textContent = '✓ Copied!';
    copyBtn.style.background = '#4CAF50';
    
    setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.background = '#667eea';
    }, 2000);
}

// Close modals when clicking outside
window.addEventListener('click', function(event) {
    const nicknameModal = document.getElementById('nicknameModal');
    const shareModal = document.getElementById('shareModal');
    
    if (event.target === nicknameModal) {
        closeNicknameModal();
    }
    
    if (event.target === shareModal) {
        closeShareModal();
    }
});

// ============ VIDEO SYNC MANAGEMENT ============

// Setup video sync event listeners
function setupVideoSync() {
    const videoPlayer = document.getElementById('videoPlayer');
    
    if (!videoPlayer) return;
    
    // Play event
    videoPlayer.addEventListener('play', function() {
        if (currentRoom && !isSyncing) {
            updateVideoStateInRoom('play');
        }
    });
    
    // Pause event
    videoPlayer.addEventListener('pause', function() {
        if (currentRoom && !isSyncing) {
            updateVideoStateInRoom('pause');
        }
    });
    
    // Seeking event (user scrubs timeline)
    videoPlayer.addEventListener('seeking', function() {
        if (currentRoom && !isSyncing) {
            updateVideoStateInRoom('seek', videoPlayer.currentTime);
        }
    });
    
    // Time update - update periodically for sync and subtitles
    videoPlayer.addEventListener('timeupdate', function() {
        // Update subtitles on every time update
        updateSubtitles(videoPlayer.currentTime);
        
        if (currentRoom && !isSyncing && !videoPlayer.paused) {
            // Only update every 0.5 seconds to avoid too many updates
            const now = Date.now();
            if (!lastVideoState || now - lastVideoState.timestamp > 500) {
                updateVideoStateInRoom('timeupdate', videoPlayer.currentTime);
            }
        }
    });
    
    // Video loaded - check if we need to sync
    videoPlayer.addEventListener('loadedmetadata', function() {
        if (currentRoom) {
            checkForVideoSync();
        }
        // Show custom controls when video is loaded
        const customControls = document.getElementById('customControls');
        if (customControls) {
            customControls.style.display = 'flex';
        }
        updatePlayPauseButton();
    });
    
    // Update play/pause button icon
    videoPlayer.addEventListener('play', function() {
        updatePlayPauseButton();
    });
    
    videoPlayer.addEventListener('pause', function() {
        updatePlayPauseButton();
    });
}

// ============ CUSTOM VIDEO CONTROLS ============

// Skip forward 10 seconds
function skipForward() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !currentVideo) return;
    
    const newTime = Math.min(videoPlayer.currentTime + 10, videoPlayer.duration);
    videoPlayer.currentTime = newTime;
    
    // Sync to room
    if (currentRoom && socket && isConnected) {
        updateVideoStateInRoom('seek', newTime);
    }
}

// Skip backward 10 seconds
function skipBackward() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !currentVideo) return;
    
    const newTime = Math.max(videoPlayer.currentTime - 10, 0);
    videoPlayer.currentTime = newTime;
    
    // Sync to room
    if (currentRoom && socket && isConnected) {
        updateVideoStateInRoom('seek', newTime);
    }
}

// Toggle play/pause
function togglePlayPause() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !currentVideo) return;
    
    if (videoPlayer.paused) {
        videoPlayer.play();
    } else {
        videoPlayer.pause();
    }
    
    // Sync happens automatically via the play/pause event listeners
}

// Update play/pause button icon
function updatePlayPauseButton() {
    const videoPlayer = document.getElementById('videoPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');
    
    if (!videoPlayer || !playPauseBtn) return;
    
    if (videoPlayer.paused) {
        playPauseBtn.textContent = '▶️';
        playPauseBtn.title = 'Play';
    } else {
        playPauseBtn.textContent = '⏸️';
        playPauseBtn.title = 'Pause';
    }
}

// Share video to room
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

// Update video state in room
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

// Sync video from room
function syncVideoFromRoom(videoState) {
    if (!currentRoom || !videoState) return;
    
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;
    
    // Get room data to check current video
    const roomDataStr = localStorage.getItem('room_' + currentRoom);
    if (!roomDataStr) return;
    
    const roomData = JSON.parse(roomDataStr);
    
    // Check if room has a video set
    if (!roomData.currentVideo) return;
    
    // Check if we have the same video loaded
    if (!currentVideo || currentVideo.id !== roomData.currentVideo.id) {
        // Try to find the video in our library
        const matchingVideo = uploadedVideos.find(v => v.id === roomData.currentVideo.id);
        
        if (matchingVideo) {
            // Load the video
            isSyncing = true;
            loadVideo(matchingVideo, false); // Don't sync back
            
            // Wait for video to load, then sync
            videoPlayer.addEventListener('loadeddata', function syncAfterLoad() {
                videoPlayer.removeEventListener('loadeddata', syncAfterLoad);
                setTimeout(() => {
                    applyVideoState(videoState);
                    isSyncing = false;
                }, 500);
            }, { once: true });
        } else {
            // Video not found - show notification (only once per video)
            if (!shownNotifications.has(roomData.currentVideo.id)) {
                showVideoSyncNotification(roomData.currentVideo.name);
                shownNotifications.add(roomData.currentVideo.id);
            }
            return;
        }
    } else {
        // Same video - just sync playback
        applyVideoState(videoState);
    }
}

// Apply video state to player
function applyVideoState(videoState) {
    if (!videoState || isSyncing) return;
    
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;
    
    // Don't sync if we were the one who made the change
    if (videoState.lastUpdatedBy === userId) {
        return;
    }
    
    isSyncing = true;
    
    // Sync time if there's a significant difference (>1 second)
    const timeDiff = Math.abs(videoPlayer.currentTime - videoState.currentTime);
    if (timeDiff > 1) {
        videoPlayer.currentTime = videoState.currentTime;
    }
    
    // Sync time if there's a significant difference (>1 second) or if it's a seek action
    if (videoState.action === 'seek') {
        videoPlayer.currentTime = videoState.currentTime;
    } else {
        const timeDiff = Math.abs(videoPlayer.currentTime - videoState.currentTime);
        if (timeDiff > 1) {
            videoPlayer.currentTime = videoState.currentTime;
        }
    }
    
    // Sync play/pause state
    if (videoState.action === 'play' && videoPlayer.paused) {
        videoPlayer.play().catch(e => console.log('Play failed:', e));
    } else if (videoState.action === 'pause' && !videoPlayer.paused) {
        videoPlayer.pause();
    }
    
    // Update play/pause button icon
    updatePlayPauseButton();
    
    // Reset sync flag after a delay
    setTimeout(() => {
        isSyncing = false;
        // Update room status to show sync indicator
        updateRoomStatus();
    }, 100);
}

// Check for video sync when video loads
function checkForVideoSync() {
    if (!currentRoom || isSyncing) return;
    
    const roomDataStr = localStorage.getItem('room_' + currentRoom);
    if (!roomDataStr) return;
    
    const roomData = JSON.parse(roomDataStr);
    
    if (roomData.videoState && roomData.currentVideo) {
        // If we have the same video, sync to it
        if (currentVideo && currentVideo.id === roomData.currentVideo.id) {
            applyVideoState(roomData.videoState);
        }
    }
}

// ============ SUBTITLE MANAGEMENT ============

// Handle subtitle file selection
function handleSubtitleSelect(event) {
    const file = event.target.files[0];
    if (file) {
        loadSubtitleFile(file);
    }
}

// Load and parse subtitle file
function loadSubtitleFile(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const content = e.target.result;
        const fileName = file.name;
        
        // Determine file type and parse accordingly
        if (fileName.endsWith('.srt')) {
            currentSubtitles = parseSRT(content);
        } else if (fileName.endsWith('.vtt')) {
            currentSubtitles = parseVTT(content);
        } else if (fileName.endsWith('.txt')) {
            // Try SRT format first
            currentSubtitles = parseSRT(content);
        }
        
        if (currentSubtitles.length > 0) {
            subtitleFileName = fileName;
            document.getElementById('subtitleControls').style.display = 'flex';
            document.getElementById('subtitleFileName').textContent = `📝 ${fileName}`;
        } else {
            alert('Could not parse subtitle file. Please check the format.');
        }
    };
    
    reader.onerror = function() {
        alert('Error reading subtitle file.');
    };
    
    reader.readAsText(file);
}

// Parse SRT format subtitles
function parseSRT(content) {
    const subtitles = [];
    const blocks = content.trim().split(/\n\s*\n/);
    
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;
        
        // Skip sequence number (first line)
        const timeLine = lines[1];
        const textLines = lines.slice(2);
        
        // Parse time format: HH:MM:SS,mmm --> HH:MM:SS,mmm
        const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,\:](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,\:](\d{3})/);
        if (!timeMatch) continue;
        
        const startTime = parseTimeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
        const endTime = parseTimeToSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
        
        // Remove HTML tags and clean text
        const text = textLines.join(' ')
            .replace(/<[^>]+>/g, '')
            .trim();
        
        if (text) {
            subtitles.push({
                start: startTime,
                end: endTime,
                text: text
            });
        }
    }
    
    return subtitles;
}

// Parse VTT format subtitles
function parseVTT(content) {
    const subtitles = [];
    const lines = content.split('\n');
    let i = 0;
    
    // Skip header (WEBVTT and optional cues)
    while (i < lines.length && !lines[i].includes('-->')) {
        i++;
    }
    
    while (i < lines.length) {
        // Skip cue identifier if present
        if (lines[i].trim() && !lines[i].includes('-->')) {
            i++;
        }
        
        // Parse time line
        const timeMatch = lines[i]?.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
        if (!timeMatch) {
            i++;
            continue;
        }
        
        const startTime = parseTimeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
        const endTime = parseTimeToSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
        
        i++;
        
        // Collect text lines until empty line
        const textLines = [];
        while (i < lines.length && lines[i].trim()) {
            textLines.push(lines[i].trim());
            i++;
        }
        
        // Remove HTML tags and clean text
        const text = textLines.join(' ')
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim();
        
        if (text) {
            subtitles.push({
                start: startTime,
                end: endTime,
                text: text
            });
        }
        
        i++;
    }
    
    return subtitles;
}

// Convert time format to seconds
function parseTimeToSeconds(hours, minutes, seconds, milliseconds) {
    return parseInt(hours) * 3600 + 
           parseInt(minutes) * 60 + 
           parseInt(seconds) + 
           parseInt(milliseconds) / 1000;
}

// Update subtitles based on current video time
function updateSubtitles(currentTime) {
    const subtitleText = document.getElementById('subtitleText');
    
    if (!subtitleText || currentSubtitles.length === 0) {
        if (subtitleText) {
            subtitleText.classList.remove('show');
        }
        return;
    }
    
    // Find subtitle for current time
    const activeSubtitle = currentSubtitles.find(sub => 
        currentTime >= sub.start && currentTime <= sub.end
    );
    
    if (activeSubtitle) {
        subtitleText.textContent = activeSubtitle.text;
        subtitleText.classList.add('show');
    } else {
        subtitleText.classList.remove('show');
    }
}

// Remove subtitle
function removeSubtitle() {
    currentSubtitles = [];
    subtitleFileName = null;
    const subtitleControls = document.getElementById('subtitleControls');
    const subtitleInput = document.getElementById('subtitleInput');
    const subtitleFileNameEl = document.getElementById('subtitleFileName');
    const subtitleText = document.getElementById('subtitleText');
    
    if (subtitleControls) subtitleControls.style.display = 'none';
    if (subtitleFileNameEl) subtitleFileNameEl.textContent = '';
    if (subtitleInput) subtitleInput.value = '';
    
    if (subtitleText) {
        subtitleText.classList.remove('show');
        subtitleText.textContent = '';
    }
}

// Show notification when someone else loads a video we don't have
function showVideoSyncNotification(videoName) {
    const videoInfo = document.getElementById('videoInfo');
    if (!videoInfo) return;
    
    // Remove any existing notifications first
    const existingNotifications = videoInfo.querySelectorAll('.video-sync-notification');
    existingNotifications.forEach(notif => notif.remove());
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = 'video-sync-notification';
    notification.style.cssText = 'background: #fff3cd; color: #856404; padding: 0.8rem; border-radius: 5px; margin-top: 0.5rem; border-left: 4px solid #ffc107;';
    notification.innerHTML = `
        <strong>📹 Room Video:</strong> Someone is watching "${videoName}". 
        Upload the same video to sync playback!
    `;
    videoInfo.appendChild(notification);
    
    // Remove after 10 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 10000);
}
