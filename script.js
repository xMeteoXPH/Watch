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
const SERVER_URL = 'https://moviehub.up.railway.app';
let socket = null;
let isConnected = false;

// Video sync management
let isSyncing = false; // Prevents sync loops
let lastVideoState = null; // Last known video state
let videoSyncInterval = null;
let shownNotifications = new Set(); // Track which video notifications have been shown
let lastStateUpdateTime = 0; // Track when we last sent a state update
let pendingStateUpdate = null; // Queue for pending state updates
let lastReceivedStateTimestamp = 0; // Track most recent received state timestamp

// ==========================
// SYNC PROTOCOL v2 (cross-platform)
// - No timeupdate spam
// - Server assigns monotonically increasing `version`
// - Clients apply only newer versions
// ==========================
const SYNC_PROTOCOL = 2;
const syncV2 = {
    enabled: true,
    version: 0,
    applying: false,
    pendingState: null,
    roomHasVideo: false,
    lastEmitAt: 0,
    lastEmitKey: '',
    lastSeekEmitAt: 0
};

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
    
    // Setup mobile controls after DOM is ready
    // Delay slightly to ensure all elements are ready
    setTimeout(() => {
        setupMobileControls();
    }, 100);
});

// Function to scroll to video player
function scrollToPlayer() {
    const watchSection = document.getElementById('watch');
    watchSection.scrollIntoView({ behavior: 'smooth' });
}

// Setup drag and drop functionality
function setupDragAndDrop() {
    const uploadBox = document.getElementById('uploadBox');
    if (!uploadBox) return;
    if (uploadBox.hasAttribute('data-dd-setup')) return;
    uploadBox.setAttribute('data-dd-setup', 'true');

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

    // Click to upload (single source of truth: programmatic click)
    uploadBox.addEventListener('click', function() {
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.click();
    });
}

// Handle file selection from input
function handleFileSelect(event) {
    // Prevent multiple triggers
    if (event.target.dataset.processing === 'true') {
        console.log('⚠️ File input already processing, ignoring duplicate event');
        return;
    }
    
    const file = event.target.files[0];
    if (file) {
        event.target.dataset.processing = 'true';
        handleFileUpload(file);
        
        // Reset after a delay to allow new uploads
        setTimeout(() => {
            event.target.dataset.processing = 'false';
        }, 1000);
    }
}

// Handle file upload
async function handleFileUpload(file) {
    // Check if file is a video
    if (!file.type.startsWith('video/')) {
        alert('Please upload a video file (MP4, MKV, etc.)');
        return;
    }

    // Show upload progress
    const fileInfo = document.getElementById('fileInfo');
    if (fileInfo) {
        fileInfo.innerHTML = `
            <p style="color: #667eea;">⏳ Uploading "${file.name}" to server...</p>
            <div style="margin-top: 10px; background: rgba(0,0,0,0.2); border-radius: 10px; overflow: hidden; height: 8px;">
                <div id="uploadProgressBar" style="background: #667eea; height: 100%; width: 0%; transition: width 0.3s;"></div>
            </div>
        `;
        fileInfo.classList.add('active');
    }

    try {
        // Upload file to server with progress tracking
        const formData = new FormData();
        formData.append('video', file);

        console.log('Uploading file to server:', file.name, 'Size:', (file.size / 1024 / 1024).toFixed(2), 'MB');
        
        const xhr = new XMLHttpRequest();
        
        // Track upload progress
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                const progressBar = document.getElementById('uploadProgressBar');
                if (progressBar) {
                    progressBar.style.width = percentComplete + '%';
                }
            }
        });
        
        const response = await new Promise((resolve, reject) => {
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        resolve({
                            ok: true,
                            status: xhr.status,
                            json: () => Promise.resolve(JSON.parse(xhr.responseText))
                        });
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    reject(new Error(`Upload failed: ${xhr.statusText}`));
                }
            };
            
            xhr.onerror = () => reject(new Error('Upload failed: network error'));
            
            xhr.open('POST', `${SERVER_URL}/api/upload`);
            xhr.send(formData);
        });

        const data = await response.json();
        
        // Remove progress bar after completion
        setTimeout(() => {
            const progressBar = document.getElementById('uploadProgressBar');
            if (progressBar && progressBar.parentElement) {
                progressBar.parentElement.style.display = 'none';
            }
        }, 500);
        console.log('Upload response:', data);

        if (!data.success || !data.video) {
            throw new Error('Server did not return video data');
        }

        // Create video object with server URL
        const videoMimeType = data.video.type || file.type || 'video/mp4';
        const videoUrl = `${SERVER_URL}/api/video/${data.video.filename}?type=${encodeURIComponent(videoMimeType)}`;
        
        const videoObject = {
            id: data.video.id,
            name: data.video.name,
            size: formatFileSize(data.video.size || file.size),
            type: videoMimeType,
            url: videoUrl,
            filename: data.video.filename,
            uploadDate: new Date().toLocaleDateString(),
            fromServer: true
        };

        // Check if video with same name already exists (replace it instead of adding duplicate)
        const existingIndex = uploadedVideos.findIndex(v => v.name === videoObject.name);
        if (existingIndex !== -1) {
            // Remove old video entry
            uploadedVideos.splice(existingIndex, 1);
            console.log('Replacing existing video:', videoObject.name);
        }
        
        // Add to uploaded videos array
        uploadedVideos.push(videoObject);
        
        // Save to localStorage
        saveVideosToStorage();

        // Display file info
        displayFileInfo(videoObject);

        // CRITICAL: Share video to room IMMEDIATELY before loading
        // This ensures other devices know about the video before play actions happen
        if (currentRoom && socket && isConnected) {
            console.log('📤 IMMEDIATELY sharing video to room before loading');
            shareVideoToRoom(videoObject);
        }
        
        // Load the video in player immediately for uploader
        // Set syncToRoom to true so it's shared again after loading (redundancy)
        loadVideo(videoObject, true);
        
        // Also share again after video loads as backup (in case socket wasn't ready)
        const videoPlayer = document.getElementById('videoPlayer');
        if (videoPlayer && currentRoom) {
            // Share again once video metadata is loaded
            const shareOnceReady = () => {
                if (currentRoom && socket && isConnected) {
                    console.log('📤 Re-sharing video to room after metadata loaded');
                    shareVideoToRoom(videoObject);
                }
            };
            
            videoPlayer.addEventListener('loadedmetadata', shareOnceReady, { once: true });
            videoPlayer.addEventListener('canplay', shareOnceReady, { once: true });
            
            // Fallback timeout
            setTimeout(() => {
                if (currentRoom && socket && isConnected) {
                    console.log('📤 Fallback: Sharing video to room');
                    shareVideoToRoom(videoObject);
                }
            }, 1000);
        }

        // Update movies library
        updateMoviesLibrary();

        console.log('Video uploaded successfully:', videoObject);

    } catch (error) {
        console.error('Upload error:', error);
        if (fileInfo) {
            fileInfo.innerHTML = `<p style="color: red;">❌ Upload failed: ${error.message}. Please try again.</p>`;
        }
        alert(`Failed to upload video: ${error.message}`);
    }

    // Reset file input after a short delay to prevent immediate re-trigger
    setTimeout(() => {
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.value = '';
            fileInput.dataset.processing = 'false';
        }
    }, 500);
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
    const videoInfo = document.getElementById('videoInfo');
    const customControls = document.getElementById('customControls');

    if (!videoPlayer) return;

    console.log('Loading video:', videoObject.name, 'URL:', videoObject.url, 'Type:', videoObject.type);

    // Pause and clear current video
    videoPlayer.pause();
    
    // Remove all existing source elements
    const sources = videoPlayer.querySelectorAll('source');
    sources.forEach(source => source.remove());
    
    // Clear direct src if set
    videoPlayer.removeAttribute('src');
    videoPlayer.load(); // Load empty state first
    
    // Set playsinline attribute for mobile (already in HTML but ensure it's set)
    videoPlayer.setAttribute('playsinline', 'true');
    videoPlayer.setAttribute('webkit-playsinline', 'true');
    videoPlayer.setAttribute('preload', 'auto');
    
    // Small delay to ensure clearing is complete, then set new source
    setTimeout(() => {
        // Create new source element (always create fresh)
        const newSource = document.createElement('source');
        newSource.id = 'videoSource';
        newSource.src = videoObject.url;
        newSource.type = videoObject.type || 'video/mp4';
        videoPlayer.appendChild(newSource);
        
        console.log('Setting video source:', videoObject.url);
        console.log('Video MIME type:', videoObject.type || 'video/mp4');
        
        // Add comprehensive error handler
        const handleLoadError = (e) => {
            const error = videoPlayer.error;
            console.error('Video load error detected!');
            console.error('Error event:', e);
            console.error('Video URL:', videoObject.url);
            console.error('Video readyState:', videoPlayer.readyState);
            console.error('Video networkState:', videoPlayer.networkState);
            if (error) {
                console.error('Video error code:', error.code);
                console.error('Video error message:', error.message);
                
                // Show error to user
                if (videoInfo) {
                    const errorMsg = document.createElement('p');
                    errorMsg.style.color = '#ff4444';
                    errorMsg.textContent = `⚠️ Error loading video: ${error.message || 'Unknown error'}. Please try again.`;
                    videoInfo.appendChild(errorMsg);
                    setTimeout(() => errorMsg.remove(), 5000);
                }
            }
            
            // Retry loading if it's a network error
            if (videoPlayer.networkState === 2 || videoPlayer.networkState === 3) {
                console.log('Retrying video load in 1 second...');
                setTimeout(() => {
                    const sources = videoPlayer.querySelectorAll('source');
                    sources.forEach(s => s.remove());
                    const retrySource = document.createElement('source');
                    retrySource.id = 'videoSource';
                    retrySource.src = videoObject.url;
                    retrySource.type = videoObject.type || 'video/mp4';
                    videoPlayer.appendChild(retrySource);
                    videoPlayer.load();
                }, 1000);
            }
        };
        
        // Add error listener before loading
        videoPlayer.removeEventListener('error', handleLoadError);
        videoPlayer.addEventListener('error', handleLoadError, { once: true });
        
        // Add success listeners
        videoPlayer.addEventListener('loadstart', () => {
            console.log('Video load started');
        }, { once: true });
        
        videoPlayer.addEventListener('loadedmetadata', () => {
            console.log('Video metadata loaded successfully');
        }, { once: true });
        
        videoPlayer.addEventListener('canplay', () => {
            console.log('Video can play');
        }, { once: true });
        
        // Force reload the video
        videoPlayer.load();
        console.log('Video load() called. Video readyState:', videoPlayer.readyState);
        
        // Check if video loaded successfully after delays
        setTimeout(() => {
            if (videoPlayer.readyState === 0 && videoPlayer.networkState !== 0) {
                console.warn('Video not loaded after 500ms');
            }
        }, 500);
        
        setTimeout(() => {
            if (videoPlayer.readyState === 0 && videoPlayer.networkState !== 0) {
                console.warn('Video still not loaded after 2000ms');
                handleLoadError(null);
            }
        }, 2000);
    }, 150);

    videoInfo.innerHTML = `
        <p><strong>Now Playing:</strong> ${videoObject.name}</p>
    `;

    currentVideo = videoObject;

    // Show custom controls when video metadata is loaded
    const showControls = () => {
        if (customControls && currentVideo) {
            customControls.style.display = 'flex';
            updatePlayPauseButton();
            // Setup mobile touch handlers when controls are shown
            setupMobileControls();
        }
    };

    // Remove any existing listeners to avoid duplicates
    videoPlayer.removeEventListener('loadedmetadata', showControls);
    videoPlayer.removeEventListener('canplay', showControls);
    videoPlayer.removeEventListener('loadeddata', showControls);
    
    // Add multiple listeners for better mobile compatibility
    videoPlayer.addEventListener('loadedmetadata', showControls, { once: true });
    videoPlayer.addEventListener('canplay', showControls, { once: true });
    videoPlayer.addEventListener('loadeddata', showControls, { once: true });
    
    // If video already has metadata, show controls immediately
    if (videoPlayer.readyState >= 1) {
        setTimeout(showControls, 100);
    }
    
    // Fallback for mobile - show controls after a delay
    setTimeout(() => {
        if (customControls && currentVideo && customControls.style.display !== 'flex') {
            console.log('Fallback: Force showing controls');
            customControls.style.display = 'flex';
            updatePlayPauseButton();
            setupMobileControls(); // Setup mobile handlers when controls are shown
        }
    }, 1000);

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
        console.log('Room state received:', data);
        roomUsers = data.users || [];
        chatMessages = data.messages || [];
        
        // Update user count with actual count from server
        const actualCount = roomUsers.length;
        console.log('Room state - updating user count:', actualCount);
        updateUserCount(actualCount);
        updateChatDisplay();
        
        // If there's a video in the room, load it
        // Always load if there's a currentVideo, even if we have one (might be different video)
        if (data.currentVideo) {
            console.log('Room has video, loading:', data.currentVideo);
            // Use a small delay to ensure DOM is ready
            setTimeout(() => {
                loadVideoFromServer(data.currentVideo);
                
                // Sync video state after video loads
                if (data.videoState) {
                    const videoPlayer = document.getElementById('videoPlayer');
                    if (videoPlayer) {
                        // Wait for video to be ready before applying state
                        const applyStateWhenReady = () => {
                            if (videoPlayer.readyState >= 2) { // HAVE_CURRENT_DATA or better
                                setTimeout(() => {
                                    if (data.videoState && typeof data.videoState.version === 'number') {
                                        syncV2.roomHasVideo = !!data.currentVideo;
                                        applyVideoControlStateV2(data.videoState);
                                    } else {
                                        applyVideoState(data.videoState);
                                    }
                                }, 300);
                            } else {
                                // Wait a bit more and try again
                                setTimeout(applyStateWhenReady, 200);
                            }
                        };
                        
                        // Try immediately if ready, otherwise wait
                        if (videoPlayer.readyState >= 2) {
                            setTimeout(() => {
                                if (data.videoState && typeof data.videoState.version === 'number') {
                                    syncV2.roomHasVideo = !!data.currentVideo;
                                    applyVideoControlStateV2(data.videoState);
                                } else {
                                    applyVideoState(data.videoState);
                                }
                            }, 500);
                        } else {
                            videoPlayer.addEventListener('canplay', () => {
                                setTimeout(() => {
                                    if (data.videoState && typeof data.videoState.version === 'number') {
                                        syncV2.roomHasVideo = !!data.currentVideo;
                                        applyVideoControlStateV2(data.videoState);
                                    } else {
                                        applyVideoState(data.videoState);
                                    }
                                }, 500);
                            }, { once: true });
                            // Fallback timeout
                            setTimeout(applyStateWhenReady, 2000);
                        }
                    }
                }
            }, 100);
        }
    });

    // User joined
    socket.on('user-joined', (data) => {
        console.log('User joined event:', data);
        // Update room users list - try to get from data.users if available, otherwise update manually
        if (data.users && Array.isArray(data.users)) {
            roomUsers = data.users;
        } else if (data.user) {
            // Add new user if not already in list
            if (!roomUsers.find(u => u.id === data.user.id)) {
                roomUsers.push(data.user);
            }
        }
        // Use count from server if available
        if (data.userCount !== undefined) {
            console.log('Updating user count from user-joined:', data.userCount);
            updateUserCount(data.userCount);
        } else {
            updateUserCount();
        }
        if (data.user) {
            addSystemMessage(`${data.user.nickname} joined the room`);
        }
    });

    // User left
    socket.on('user-left', (data) => {
        console.log('User left event:', data);
        roomUsers = roomUsers.filter(u => u.id !== data.userId);
        // Use count from server if available
        if (data.userCount !== undefined) {
            console.log('Updating user count from user-left:', data.userCount);
            updateUserCount(data.userCount);
        } else {
            updateUserCount();
        }
    });

    // User count update
    socket.on('user-count-update', (data) => {
        console.log('User count update event:', data);
        // Use count from server
        if (data.count !== undefined) {
            updateUserCount(data.count);
        } else {
            updateUserCount();
        }
    });

    // Chat message
    socket.on('chat-message', (messageObj) => {
        chatMessages.push(messageObj);
        updateChatDisplay();
    });

    // Video loaded/shared (protocol v2 capable)
    socket.on('video-loaded', (data) => {
        console.log('📥 Received video-loaded event:', data);

        if (!data || !data.video) return;

        syncV2.roomHasVideo = true;

        const shouldLoad = !currentVideo || currentVideo.id !== data.video.id;
        if (shouldLoad) {
            loadVideoFromServer(data.video);
        }

        // Apply baseline state if provided (v2)
        if (data.state && typeof data.state.version === 'number') {
            // Wait a moment for the video element to be ready if we just loaded it
            setTimeout(() => {
                applyVideoControlStateV2(data.state);
                tryApplyPendingStateV2();
            }, 300);
        }

        // Notify (only for others to avoid spam)
        if (data.userId && data.userId !== userId) {
            addSystemMessage(`${data.user?.nickname || 'Someone'} loaded video: ${data.video.name}`);
        }
    });

    // ==========================
    // VIDEO CONTROL v2
    // ==========================
    socket.on('video-control', (data) => {
        const state = data?.state || data;
        applyVideoControlStateV2(state);
        tryApplyPendingStateV2();
    });

    // Legacy video state update (deprecated)
    // FREE-FOR-ALL: Anyone can control and all actions sync to everyone
    socket.on('video-state-update', (data) => {
        // If v2 is enabled, ignore legacy updates
        if (syncV2.enabled) return;
        const receiveTimestamp = new Date().toISOString();
        console.log('📥📥📥 RECEIVED VIDEO-STATE-UPDATE EVENT at', receiveTimestamp);
        console.log('   Device: ALL (Desktop/Mobile/Tablet)');
        console.log('   Raw data:', JSON.stringify(data, null, 2));
        
        // Server sends videoState wrapped in object: { videoState: ... }
        // Also handle direct videoState object for backward compatibility
        const videoState = data.videoState || data;
        
        console.log('   Extracted videoState:', JSON.stringify(videoState, null, 2));
        console.log('   From user:', videoState?.lastUpdatedBy, '| My userId:', userId);
        console.log('   Action:', videoState?.action, '| Time:', videoState?.currentTime, '| IsPlaying:', videoState?.isPlaying);
        
        if (!videoState || !videoState.lastUpdatedBy) {
            console.error('❌❌❌ INVALID VIDEO STATE UPDATE:');
            console.error('   videoState:', videoState);
            console.error('   lastUpdatedBy:', videoState?.lastUpdatedBy);
            return;
        }
        
        // FREE-FOR-ALL: Apply state from ANY user (except ourselves)
        // This allows uploader to control viewer, and viewer to control uploader
        if (videoState.lastUpdatedBy !== userId) {
            console.log('✅✅✅ APPLYING STATE FROM ANOTHER USER');
            console.log('   Action:', videoState.action);
            console.log('   From user:', videoState.lastUpdatedBy, '| My userId:', userId);
            console.log('   IsPlaying:', videoState.isPlaying, '| CurrentTime:', videoState.currentTime);
            console.log('   VideoId:', videoState.videoId, '| CurrentVideo:', currentVideo?.id);
            
            // FORCE APPLY - bypass all checks
            try {
                applyVideoState(videoState);
                console.log('   ✅ applyVideoState() called successfully');
            } catch (error) {
                console.error('   ❌ ERROR in applyVideoState:', error);
                console.error('   Stack:', error.stack);
                
                // Fallback: Direct apply
                const videoPlayer = document.getElementById('videoPlayer');
                if (videoPlayer && videoState.action === 'pause') {
                    console.log('   🔄 FALLBACK: Direct pause');
                    videoPlayer.pause();
                    updatePlayPauseButton();
                } else if (videoPlayer && videoState.action === 'play') {
                    console.log('   🔄 FALLBACK: Direct play');
                    videoPlayer.play().catch(e => console.error('Play failed:', e));
                    updatePlayPauseButton();
                }
            }
        } else {
            console.log('⚠️ Ignoring own video state update (we sent this)');
            console.log('   Action:', videoState.action, '| My userId:', userId);
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
        fileInput.addEventListener('change', handleFileSelect);
        fileInput.setAttribute('data-setup', 'true');
        console.log('✅ File input setup complete');
    }
    
    if (videoPlayer && !videoPlayer.hasAttribute('data-sync-v2-setup')) {
        setupVideoSyncV2();
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
    
    // Always create a fresh video object to ensure correct URL
    // Include the MIME type as a query parameter so server knows the content type
    const videoMimeType = videoData.type || 'video/mp4';
    const videoUrl = `${SERVER_URL}/api/video/${videoData.filename || videoData.id}?type=${encodeURIComponent(videoMimeType)}`;
    console.log('Creating video object with URL:', videoUrl);
    console.log('Video MIME type:', videoMimeType);
    
    const videoObject = {
        id: videoData.id,
        name: videoData.name,
        size: videoData.size || 'Unknown',
        type: videoMimeType,
        url: videoUrl,
        filename: videoData.filename || videoData.id,
        uploadDate: new Date().toLocaleDateString(),
        fromServer: true
    };
    
    // Check if we already have this video in our array (by ID or name), update it if so
    const existingIndexById = uploadedVideos.findIndex(v => v.id === videoData.id);
    const existingIndexByName = uploadedVideos.findIndex(v => v.name === videoData.name);
    const existingIndex = existingIndexById !== -1 ? existingIndexById : existingIndexByName;
    
    if (existingIndex !== -1) {
        // Update existing video
        uploadedVideos[existingIndex] = videoObject;
        console.log('Updated existing video:', videoObject.name);
    } else {
        // Add new video
        uploadedVideos.push(videoObject);
    }
    saveVideosToStorage();
    
    // Load in player - this will show the video and controls
    loadVideo(videoObject, false);
    
    // Ensure custom controls are shown for other users with robust loading
    const videoPlayer = document.getElementById('videoPlayer');
    const customControls = document.getElementById('customControls');
    
    if (videoPlayer && customControls) {
        let controlsShown = false;
        
        // Show controls when video metadata is loaded
        const showControlsOnLoad = () => {
            if (customControls && !controlsShown) {
                controlsShown = true;
                customControls.style.display = 'flex';
                updatePlayPauseButton();
                console.log('Controls shown for other user');
            }
        };
        
        // Add comprehensive error handler with retry
        const errorHandler = (e) => {
            console.error('Video load error for other user:', e);
            console.error('Video src:', videoPlayer.src);
            console.error('Video readyState:', videoPlayer.readyState);
            console.error('Video networkState:', videoPlayer.networkState);
            
            const error = videoPlayer.error;
            if (error) {
                console.error('Video error code:', error.code);
                console.error('Video error message:', error.message);
                
                // Retry loading after a delay
                setTimeout(() => {
                    console.log('Retrying video load...');
                    if (videoObject && videoObject.url) {
                        // Clear and reload
                        const sources = videoPlayer.querySelectorAll('source');
                        sources.forEach(s => s.remove());
                        videoPlayer.removeAttribute('src');
                        
                        setTimeout(() => {
                            const newSource = document.createElement('source');
                            newSource.src = videoObject.url;
                            newSource.type = videoObject.type || 'video/mp4';
                            videoPlayer.appendChild(newSource);
                            videoPlayer.load();
                        }, 100);
                    }
                }, 1000);
            }
        };
        
        // Remove old error handlers and add new one
        videoPlayer.removeEventListener('error', errorHandler);
        videoPlayer.addEventListener('error', errorHandler, { once: true });
        
        // Add loadstart listener
        videoPlayer.addEventListener('loadstart', () => {
            console.log('Video load started for other user');
        }, { once: true });
        
        // Multiple event listeners for better compatibility
        const events = ['loadedmetadata', 'canplay', 'canplaythrough', 'loadeddata'];
        events.forEach(eventName => {
            videoPlayer.addEventListener(eventName, () => {
                console.log(`Video ${eventName} event fired for other user`);
                showControlsOnLoad();
            }, { once: true });
        });
        
        // Immediate check if video already has metadata
        if (videoPlayer.readyState >= 1) {
            console.log('Video already has metadata, readyState:', videoPlayer.readyState);
            setTimeout(showControlsOnLoad, 100);
        }
        
        // Fallback: ensure controls are shown after delays
        setTimeout(() => {
            if (customControls && customControls.style.display !== 'flex' && currentVideo) {
                console.log('Fallback 1: Force showing controls');
                showControlsOnLoad();
            }
        }, 800);
        
        setTimeout(() => {
            if (customControls && customControls.style.display !== 'flex' && currentVideo) {
                console.log('Fallback 2: Force showing controls');
                showControlsOnLoad();
            }
            
            // Double-check video is loading
            if (videoPlayer.readyState === 0 && !videoPlayer.src && !videoPlayer.querySelector('source')?.src) {
                console.warn('Video not loading, retrying with direct src...');
                const source = videoPlayer.querySelector('source');
                if (source && videoObject.url) {
                    source.src = videoObject.url;
                    videoPlayer.load();
                }
            }
        }, 2000);
    }
    
    // Update library
    updateMoviesLibrary();
}

// Update user count display
function updateUserCount(overrideCount = null) {
    // Use override count if provided (from server), otherwise use roomUsers array length
    const userCount = overrideCount !== null ? overrideCount : roomUsers.length;
    console.log('Updating user count display:', userCount, '(override:', overrideCount, 'array length:', roomUsers.length, ')');
    
    const userCountEl = document.getElementById('userCount');
    const chatUserCountEl = document.getElementById('chatUserCount');
    const roomStatusUsersEl = document.getElementById('roomStatusUsers');
    
    if (userCountEl) {
        userCountEl.textContent = userCount;
    }
    if (chatUserCountEl) {
        chatUserCountEl.textContent = userCount + ' online';
    }
    
    if (currentRoom && roomStatusUsersEl) {
        roomStatusUsersEl.textContent = userCount;
    }
    
    // Also update roomUsers array length if it's inconsistent (for safety)
    if (overrideCount !== null && roomUsers.length !== overrideCount) {
        console.log('Fixing roomUsers array length mismatch. Was:', roomUsers.length, 'Should be:', overrideCount);
        // Don't modify array, just log the mismatch for debugging
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

// --------------------------
// SYNC v2 helpers
// --------------------------
function emitVideoControlV2(action, time = null) {
    if (!syncV2.enabled) return;

    const videoPlayer = document.getElementById('videoPlayer');
    if (!currentRoom || !socket || !isConnected || !videoPlayer || !currentVideo || !userId) {
        return;
    }

    const now = Date.now();
    const t = typeof time === 'number' ? time : videoPlayer.currentTime;
    const key = `${action}:${Math.floor(t * 10)}`; // 100ms buckets

    // Basic debounce to avoid duplicate emits (play triggers multiple events on mobile)
    if (now - syncV2.lastEmitAt < 150 && syncV2.lastEmitKey === key) return;
    syncV2.lastEmitAt = now;
    syncV2.lastEmitKey = key;

    // Ensure the socket is joined to the room
    joinRoomSocket(currentRoom);

    // If server doesn't have the current video yet, share it first
    if (!syncV2.roomHasVideo && currentVideo) {
        shareVideoToRoom(currentVideo);
    }

    const payload = {
        protocol: SYNC_PROTOCOL,
        roomCode: currentRoom,
        userId,
        videoId: currentVideo.id,
        action,
        currentTime: t,
        // Provide desired playing state explicitly
        isPlaying: action === 'play' ? true : (action === 'pause' ? false : !videoPlayer.paused),
        clientSentAt: now
    };

    socket.emit('video-control', payload, (ack) => {
        if (ack && ack.ok && typeof ack.version === 'number') {
            // We still wait for the broadcast, but keeping our version non-decreasing helps
            syncV2.version = Math.max(syncV2.version, ack.version);
        }
    });
}

function applyVideoControlStateV2(state) {
    if (!syncV2.enabled || !state) return;
    if (typeof state.version === 'number' && state.version <= syncV2.version) return;

    // Update version first to prevent re-entrancy loops
    if (typeof state.version === 'number') syncV2.version = state.version;

    // If we don't have the right video loaded yet, queue the state
    if (!currentVideo || currentVideo.id !== state.videoId) {
        syncV2.pendingState = state;
        return;
    }

    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;

    syncV2.applying = true;

    try {
        const desiredTime = typeof state.currentTime === 'number' ? state.currentTime : videoPlayer.currentTime;
        const timeDiff = Math.abs(videoPlayer.currentTime - desiredTime);
        if (timeDiff > 0.35) {
            videoPlayer.currentTime = desiredTime;
        }

        const shouldPlay = !!state.isPlaying;
        if (!shouldPlay) {
            videoPlayer.pause();
        } else {
            const p = videoPlayer.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => {
                    // Autoplay restrictions can block remote play on iOS; pause/play from mobile -> PC still works.
                });
            }
        }
    } finally {
        // Release apply lock after a short delay so native events don't echo back
        setTimeout(() => {
            syncV2.applying = false;
            updatePlayPauseButton();
        }, 150);
    }
}

function tryApplyPendingStateV2() {
    if (syncV2.pendingState && currentVideo && syncV2.pendingState.videoId === currentVideo.id) {
        const pending = syncV2.pendingState;
        syncV2.pendingState = null;
        applyVideoControlStateV2(pending);
    }
}

// Store event handlers so we can remove them
let videoSyncHandlers = {
    play: null,
    pause: null,
    seeked: null,
    timeupdate: null,
    loadedmetadata: null,
    playButton: null,
    pauseButton: null
};

// Setup video sync event listeners (SYNC v2 - play/pause/seek only)
function setupVideoSyncV2() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;

    if (videoPlayer.hasAttribute('data-sync-v2-setup')) {
        console.log('Video sync v2 already set up, skipping...');
        return;
    }

    // Mark setup
    videoPlayer.setAttribute('data-sync-v2-setup', 'true');

    // Always update subtitles locally
    videoPlayer.addEventListener('timeupdate', () => {
        updateSubtitles(videoPlayer.currentTime);
    });

    // Local -> room (only when user-initiated; ignore when applying remote state)
    const emitIfUser = (action) => {
        if (!syncV2.enabled) return;
        if (syncV2.applying) return;
        if (!currentRoom || !socket || !isConnected || !currentVideo) return;
        emitVideoControlV2(action, videoPlayer.currentTime);
    };

    videoPlayer.addEventListener('play', () => emitIfUser('play'));
    videoPlayer.addEventListener('pause', () => emitIfUser('pause'));

    // Seek (native scrubbing)
    videoPlayer.addEventListener('seeked', () => {
        if (syncV2.applying) return;
        const now = Date.now();
        if (now - syncV2.lastSeekEmitAt < 250) return; // debounce
        syncV2.lastSeekEmitAt = now;
        emitIfUser('seek');
    });

    // Keep UI in sync
    videoPlayer.addEventListener('play', updatePlayPauseButton);
    videoPlayer.addEventListener('pause', updatePlayPauseButton);
    videoPlayer.addEventListener('loadedmetadata', () => {
        updatePlayPauseButton();
        tryApplyPendingStateV2();
    });

    console.log('✅ Video sync v2 event listeners set up');
}

// Setup video sync event listeners (only once)
function setupVideoSync() {
    const videoPlayer = document.getElementById('videoPlayer');
    
    if (!videoPlayer) return;
    
    // Check if already set up to avoid duplicate listeners
    if (videoPlayer.hasAttribute('data-sync-setup')) {
        console.log('Video sync already set up, skipping...');
        return;
    }
    
    // Remove any existing listeners first (just in case)
    if (videoSyncHandlers.play) videoPlayer.removeEventListener('play', videoSyncHandlers.play);
    if (videoSyncHandlers.pause) videoPlayer.removeEventListener('pause', videoSyncHandlers.pause);
    if (videoSyncHandlers.seeked) videoPlayer.removeEventListener('seeked', videoSyncHandlers.seeked);
    if (videoSyncHandlers.timeupdate) videoPlayer.removeEventListener('timeupdate', videoSyncHandlers.timeupdate);
    if (videoSyncHandlers.loadedmetadata) videoPlayer.removeEventListener('loadedmetadata', videoSyncHandlers.loadedmetadata);
    if (videoSyncHandlers.playButton) videoPlayer.removeEventListener('play', videoSyncHandlers.playButton);
    if (videoSyncHandlers.pauseButton) videoPlayer.removeEventListener('pause', videoSyncHandlers.pauseButton);
    
    // Play event - MOBILE COMPATIBLE: Works on Android, iOS, Windows
    // This handles native play events AND mobile touch events
    videoSyncHandlers.play = function() {
        if (currentRoom && !isSyncing) {
            // Small delay to get accurate currentTime after play starts
            // Works on all platforms: Android, iOS, Windows
            setTimeout(() => {
                if (!videoPlayer.paused && currentRoom && !isSyncing) {
                    console.log('📢 Native play event - syncing (Android/iOS/Windows compatible)');
                    updateVideoStateInRoom('play', videoPlayer.currentTime);
                }
            }, 200); // Longer delay for mobile devices
        }
    };
    // Add multiple event types for mobile compatibility
    videoPlayer.addEventListener('play', videoSyncHandlers.play);
    videoPlayer.addEventListener('playing', videoSyncHandlers.play); // Mobile fallback
    // Also listen to canplaythrough for mobile browsers
    videoPlayer.addEventListener('canplaythrough', function() {
        if (currentRoom && !isSyncing && !videoPlayer.paused) {
            setTimeout(() => {
                if (!videoPlayer.paused && currentRoom && !isSyncing) {
                    console.log('📢 Mobile canplaythrough - syncing play state');
                    updateVideoStateInRoom('play', videoPlayer.currentTime);
                }
            }, 200);
        }
    });
    
    // Pause event - MOBILE COMPATIBLE: Works on Android, iOS, Windows
    // This handles native pause events AND mobile touch events
    videoSyncHandlers.pause = function() {
        if (currentRoom && !isSyncing) {
            // For pause, sync after small delay (mobile compatible)
            // Works on all platforms: Android, iOS, Windows
            setTimeout(() => {
                if (currentRoom && !isSyncing && videoPlayer.paused) {
                    console.log('📢 Native pause event - syncing (Android/iOS/Windows compatible)');
                    updateVideoStateInRoom('pause', videoPlayer.currentTime);
                }
            }, 150); // Longer delay for mobile devices
        }
    };
    videoPlayer.addEventListener('pause', videoSyncHandlers.pause);
    // Also listen to pause event with different timing for mobile
    videoPlayer.addEventListener('waiting', function() {
        if (currentRoom && !isSyncing && videoPlayer.paused) {
            setTimeout(() => {
                if (videoPlayer.paused && currentRoom && !isSyncing) {
                    console.log('📢 Mobile waiting event - syncing pause state');
                    updateVideoStateInRoom('pause', videoPlayer.currentTime);
                }
            }, 150);
        }
    });
    
    // Seeking event (user scrubs timeline) - use seeked instead of seeking for more accurate time
    // NOTE: This only syncs if NOT blocked by isSyncing (which custom controls set)
    // Custom controls (skip forward/backward) handle their own sync, so this is mainly for timeline scrubbing
    videoSyncHandlers.seeked = function() {
        if (currentRoom && !isSyncing) {
            // Use seeked event which fires after seeking is complete
            setTimeout(() => {
                if (currentRoom && !isSyncing) {
                    console.log('📢 Native seeked event - syncing seek');
                    updateVideoStateInRoom('seek', videoPlayer.currentTime);
                }
            }, 100);
        }
    };
    videoPlayer.addEventListener('seeked', videoSyncHandlers.seeked);
    
    // Time update - update periodically for sync and subtitles
    videoSyncHandlers.timeupdate = function() {
        // Update subtitles on every time update
        updateSubtitles(videoPlayer.currentTime);
        
        // CRITICAL: STOP timeupdate from syncing when paused - it was overriding pause!
        // Only sync timeupdate if video is playing AND not paused AND not syncing
        if (currentRoom && !isSyncing && !videoPlayer.paused) {
            // Only update every 2 seconds to reduce frequency (was 1 second)
            const now = Date.now();
            // CRITICAL: Also check that the last action wasn't pause/play to prevent override
            const lastAction = lastVideoState?.action;
            const timeSinceLastAction = lastVideoState ? now - lastVideoState.timestamp : Infinity;
            
            // Don't sync timeupdate if a pause/play happened recently (within 2 seconds)
            // This prevents timeupdate from overriding pause/play actions
            if (lastAction === 'pause' || lastAction === 'play') {
                if (timeSinceLastAction < 2000) {
                    // Too soon after pause/play - skip timeupdate to prevent override
                    return;
                }
            }
            
            // Only sync if enough time has passed
            if (!lastVideoState || now - lastVideoState.timestamp > 2000) {
                // For timeupdate, explicitly pass isPlaying as true since video is playing
                // This ensures we don't accidentally pause the video on the receiving end
                updateVideoStateInRoom('timeupdate', videoPlayer.currentTime, true);
            }
        }
    };
    videoPlayer.addEventListener('timeupdate', videoSyncHandlers.timeupdate);
    
    // Video loaded - check if we need to sync
    videoSyncHandlers.loadedmetadata = function() {
        if (currentRoom) {
            checkForVideoSync();
        }
        // Show custom controls when video is loaded
        const customControls = document.getElementById('customControls');
        if (customControls) {
            customControls.style.display = 'flex';
        }
        updatePlayPauseButton();
    };
    videoPlayer.addEventListener('loadedmetadata', videoSyncHandlers.loadedmetadata);
    
    // Update play/pause button icon
    videoSyncHandlers.playButton = function() {
        updatePlayPauseButton();
    };
    videoPlayer.addEventListener('play', videoSyncHandlers.playButton);
    
    videoSyncHandlers.pauseButton = function() {
        updatePlayPauseButton();
    };
    videoPlayer.addEventListener('pause', videoSyncHandlers.pauseButton);
    
    // Mark as set up
    videoPlayer.setAttribute('data-sync-setup', 'true');
    console.log('Video sync event listeners set up');
}

// ============ MOBILE CONTROLS SETUP ============
// CRITICAL: Mobile browsers (Android/iOS/iPad) need proper event handlers
// onclick attributes don't work reliably on mobile - use JavaScript event listeners instead

// Universal button handler that works on ALL platforms (Desktop, Android, iOS, iPad)
function handleControlButtonClick(action) {
    console.log('🎮🎮🎮 CONTROL BUTTON CLICKED:', action, 'Platform: All');
    console.log('   Timestamp:', new Date().toISOString());
    console.log('   UserId:', userId);
    console.log('   CurrentRoom:', currentRoom);
    console.log('   Socket exists:', !!socket);
    console.log('   Socket connected:', socket?.connected);
    console.log('   isConnected:', isConnected);
    
    // VERIFY CONNECTION FIRST
    if (!socket || !socket.connected || !isConnected) {
        console.error('❌❌❌ SOCKET NOT CONNECTED - Cannot sync!');
        console.error('   Attempting to reconnect...');
        if (socket) {
            socket.connect();
        } else {
            connectToServer();
        }
        // Still try to execute locally
    }
    
    try {
        switch(action) {
            case 'togglePlayPause':
                console.log('   → Calling togglePlayPause()');
                togglePlayPause();
                break;
            case 'skipForward':
                console.log('   → Calling skipForward()');
                skipForward();
                break;
            case 'skipBackward':
                console.log('   → Calling skipBackward()');
                skipBackward();
                break;
            default:
                console.error('Unknown action:', action);
        }
    } catch (error) {
        console.error('❌ ERROR in handleControlButtonClick:', error);
        console.error('   Stack:', error.stack);
    }
}

function setupMobileControls() {
    console.log('📱 Setting up controls for ALL platforms (Desktop, Android, iOS, iPad)...');
    
    // Wait for controls to be available
    const setupControls = () => {
        const playPauseBtn = document.getElementById('playPauseBtn');
        const skipForwardBtn = document.getElementById('skipForwardBtn');
        const skipBackwardBtn = document.getElementById('skipBackwardBtn');
        
        if (!playPauseBtn || !skipForwardBtn || !skipBackwardBtn) {
            // Retry after a short delay if controls aren't ready yet
            console.log('📱 Controls not ready, retrying in 500ms...');
            setTimeout(setupControls, 500);
            return;
        }
        
        console.log('📱 Found all control buttons, attaching universal handlers...');
        console.log('   - Play/Pause button:', !!playPauseBtn);
        console.log('   - Skip Forward button:', !!skipForwardBtn);
        console.log('   - Skip Backward button:', !!skipBackwardBtn);
        
        // Remove ALL existing listeners to avoid duplicates
        // Clone buttons to remove all event listeners (preserves IDs)
        const playBtnParent = playPauseBtn.parentNode;
        const forwardBtnParent = skipForwardBtn.parentNode;
        const backwardBtnParent = skipBackwardBtn.parentNode;
        
        const newPlayPause = playPauseBtn.cloneNode(true);
        newPlayPause.id = 'playPauseBtn'; // Ensure ID is preserved
        playBtnParent.replaceChild(newPlayPause, playPauseBtn);
        
        const newSkipForward = skipForwardBtn.cloneNode(true);
        newSkipForward.id = 'skipForwardBtn'; // Ensure ID is preserved
        forwardBtnParent.replaceChild(newSkipForward, skipForwardBtn);
        
        const newSkipBackward = skipBackwardBtn.cloneNode(true);
        newSkipBackward.id = 'skipBackwardBtn'; // Ensure ID is preserved
        backwardBtnParent.replaceChild(newSkipBackward, skipBackwardBtn);
        
        // Get fresh references after cloning
        const playBtn = document.getElementById('playPauseBtn');
        const forwardBtn = document.getElementById('skipForwardBtn');
        const backwardBtn = document.getElementById('skipBackwardBtn');
        
        if (!playBtn || !forwardBtn || !backwardBtn) {
            console.error('❌ Failed to get button references after cloning');
            return;
        }
        
        // Universal handler that works on ALL platforms
        const createUniversalHandler = (action) => {
            let lastTriggerTime = 0;
            return (e) => {
                // Prevent double-firing (debounce within 200ms)
                const now = Date.now();
                if (now - lastTriggerTime < 200) {
                    console.log('⏭️ Debouncing rapid trigger:', action);
                    return false;
                }
                lastTriggerTime = now;
                
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log('📱 Universal handler triggered:', action, 'Event type:', e.type);
                console.log('   Button:', e.target.id || e.target.className);
                
                // Call the handler function
                try {
                    handleControlButtonClick(action);
                } catch (error) {
                    console.error('❌ Error in handleControlButtonClick:', error);
                }
                return false;
            };
        };
        
        // Attach MULTIPLE event types for maximum compatibility
        // Touch events for mobile (Android, iOS, iPad)
        const playHandler = createUniversalHandler('togglePlayPause');
        const forwardHandler = createUniversalHandler('skipForward');
        const backwardHandler = createUniversalHandler('skipBackward');
        
        // Touch events (mobile)
        playBtn.addEventListener('touchend', playHandler, { passive: false, capture: true });
        forwardBtn.addEventListener('touchend', forwardHandler, { passive: false, capture: true });
        backwardBtn.addEventListener('touchend', backwardHandler, { passive: false, capture: true });
        
        // Click events (desktop + mobile fallback)
        playBtn.addEventListener('click', playHandler, { capture: true });
        forwardBtn.addEventListener('click', forwardHandler, { capture: true });
        backwardBtn.addEventListener('click', backwardHandler, { capture: true });
        
        // Mouse events (desktop)
        playBtn.addEventListener('mousedown', playHandler, { capture: true });
        forwardBtn.addEventListener('mousedown', forwardHandler, { capture: true });
        backwardBtn.addEventListener('mousedown', backwardHandler, { capture: true });
        
        // Pointer events (modern browsers)
        playBtn.addEventListener('pointerup', playHandler, { capture: true });
        forwardBtn.addEventListener('pointerup', forwardHandler, { capture: true });
        backwardBtn.addEventListener('pointerup', backwardHandler, { capture: true });
        
        console.log('✅ Universal event handlers attached to ALL control buttons');
        console.log('   Works on: Desktop, Android, iOS, iPad');
    };
    
    // Try to set up immediately
    setupControls();
    
    // Also set up when video loads (controls might be hidden initially)
    const videoPlayer = document.getElementById('videoPlayer');
    if (videoPlayer) {
        videoPlayer.addEventListener('loadedmetadata', () => {
            setTimeout(setupControls, 200);
        }, { once: true });
        videoPlayer.addEventListener('canplay', () => {
            setTimeout(setupControls, 200);
        }, { once: true });
        videoPlayer.addEventListener('loadeddata', () => {
            setTimeout(setupControls, 200);
        }, { once: true });
    }
    
    // Also set up when controls are shown
    const customControls = document.getElementById('customControls');
    if (customControls) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (customControls.style.display === 'flex') {
                        setTimeout(setupControls, 100);
                    }
                }
            });
        });
        observer.observe(customControls, { attributes: true, attributeFilter: ['style'] });
    }
}

// ============ CUSTOM VIDEO CONTROLS ============

// DIRECT SYNC FUNCTION - ALWAYS WORKS (for custom controls)
// This bypasses all debouncing and state checks - just emits directly
// CRITICAL: This must NOT be blocked by isSyncing or any other state
function emitVideoStateDirect(action, time, isPlaying) {
    console.log('🎯 emitVideoStateDirect CALLED - BYPASSING ALL CHECKS');
    console.log('  Parameters: action=', action, 'time=', time, 'isPlaying=', isPlaying);
    console.log('  Current state: isSyncing=', isSyncing, 'lastStateUpdateTime=', lastStateUpdateTime);
    
    // MINIMAL CHECKS ONLY - Don't block on isSyncing or debouncing
    if (!currentRoom || !socket || !currentVideo || !userId) {
        console.error('❌ CANNOT EMIT: Missing required data');
        console.error('  currentRoom:', !!currentRoom, 'socket:', !!socket, 'currentVideo:', !!currentVideo, 'userId:', !!userId);
        return false;
    }
    
    if (!socket.connected && !isConnected) {
        console.error('❌ CANNOT EMIT: Socket not connected');
        console.error('  socket.connected:', socket?.connected, 'isConnected:', isConnected);
        return false;
    }
    
    console.log('✅ Requirements met, emitting DIRECTLY (no debouncing, no isSyncing check)');
    
    const now = Date.now();
    const videoState = {
        videoId: currentVideo.id,
        currentTime: time,
        action: action,
        isPlaying: isPlaying,
        lastUpdatedBy: userId,
        timestamp: now
    };
    
    // Update state AFTER successful emit
    lastVideoState = videoState;
    lastStateUpdateTime = now;
    
    const emitData = {
        roomCode: currentRoom,
        videoState: videoState
    };
    
    console.log('🚀 DIRECT EMIT: Sending NOW (bypassing debouncing):');
    console.log('  User:', userId, 'Room:', currentRoom, 'Action:', action);
    console.log('  Data:', JSON.stringify(emitData, null, 2));
    
    try {
        // CRITICAL: Emit directly, don't check isSyncing or debouncing here
        socket.emit('video-state-update', emitData);
        console.log('✅ DIRECT EMIT: Successfully called socket.emit()');
        console.log('   Check server logs for "SERVER RECEIVED" message');
        return true;
    } catch (error) {
        console.error('❌ DIRECT EMIT ERROR:', error);
        console.error('   Error stack:', error.stack);
        return false;
    }
}

// Skip forward 10 seconds - MOBILE COMPATIBLE: Works on Android, iOS, Windows
// FREE-FOR-ALL: Works for UPLOADER AND VIEWER on ALL platforms
function skipForward() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;

    const duration = Number.isFinite(videoPlayer.duration) ? videoPlayer.duration : Infinity;
    videoPlayer.currentTime = Math.min(videoPlayer.currentTime + 10, duration);

    // SYNC v2: emit seek (some browsers don't reliably fire seeked for programmatic seeks)
    if (currentRoom && socket && isConnected && currentVideo && !syncV2.applying) {
        setTimeout(() => {
            if (!syncV2.applying) {
                syncV2.lastSeekEmitAt = Date.now();
                emitVideoControlV2('seek', videoPlayer.currentTime);
            }
        }, 120);
    }
}

// Skip backward 10 seconds - MOBILE COMPATIBLE: Works on Android, iOS, Windows
// FREE-FOR-ALL: Works for UPLOADER AND VIEWER on ALL platforms
function skipBackward() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;

    videoPlayer.currentTime = Math.max(videoPlayer.currentTime - 10, 0);

    // SYNC v2: emit seek
    if (currentRoom && socket && isConnected && currentVideo && !syncV2.applying) {
        setTimeout(() => {
            if (!syncV2.applying) {
                syncV2.lastSeekEmitAt = Date.now();
                emitVideoControlV2('seek', videoPlayer.currentTime);
            }
        }, 120);
    }
}

// Toggle play/pause - MOBILE COMPATIBLE: Works on Android, iOS, Windows
// FREE-FOR-ALL: Works for UPLOADER AND VIEWER on ALL platforms
function togglePlayPause() {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) return;

    const wasPaused = videoPlayer.paused;

    // Local action first (user gesture -> required for iOS Safari)
    if (wasPaused) {
        const p = videoPlayer.play();
        if (p && typeof p.catch === 'function') {
            p.catch(() => {});
        }
        // Emit v2 after a tiny delay (play event may fire multiple times; v2 emit is debounced)
        setTimeout(() => {
            if (!syncV2.applying && currentRoom && socket && isConnected && currentVideo) {
                emitVideoControlV2('play', videoPlayer.currentTime);
            }
        }, 80);
    } else {
        videoPlayer.pause();
        setTimeout(() => {
            if (!syncV2.applying && currentRoom && socket && isConnected && currentVideo) {
                emitVideoControlV2('pause', videoPlayer.currentTime);
            }
        }, 30);
    }
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
    if (!currentRoom || !socket || !isConnected) {
        console.warn('Cannot share video to room - not connected or no room');
        return;
    }
    
    // Make sure we have the filename (required for server video streaming)
    if (!videoObject.filename && !videoObject.fromServer) {
        console.error('Cannot share video - missing filename. Video object:', videoObject);
        alert('Video upload may have failed. Please try uploading again.');
        return;
    }
    
    const videoData = {
        id: videoObject.id,
        name: videoObject.name,
        size: videoObject.size,
        type: videoObject.type,
        filename: videoObject.filename || videoObject.id // Ensure filename is sent
    };
    
    console.log('Sharing video to room:', currentRoom, 'Video data:', videoData);
    
    // Send video info via WebSocket
    // Ensure joined before sharing
    joinRoomSocket(currentRoom);
    socket.emit('video-loaded', {
        roomCode: currentRoom,
        userId: userId,
        video: videoData
    }, (ack) => {
        if (ack && ack.ok) {
            syncV2.roomHasVideo = true;
            if (typeof ack.version === 'number') {
                syncV2.version = Math.max(syncV2.version, ack.version);
            }
        }
    });
    
    // Update room status
    updateRoomStatus();
    
    // Add system message
    addSystemMessage(`${userNickname} loaded video: ${videoObject.name}`);
}

// Update video state in room - UNIFIED SYNC FUNCTION FOR UPLOADER AND VIEWER
// This function works for BOTH uploader and viewer - FREE-FOR-ALL control
function updateVideoStateInRoom(action, time = null, overrideIsPlaying = null) {
    // CRITICAL CHECKS - Make sure we can sync (uploader OR viewer)
    if (!currentRoom) {
        console.warn('❌ Cannot update video state: no currentRoom');
        console.warn('  currentRoom:', currentRoom, 'userId:', userId);
        return;
    }
    
    if (!socket) {
        console.warn('❌ Cannot update video state: no socket');
        console.warn('  socket:', socket, 'userId:', userId);
        return;
    }
    
    if (!isConnected) {
        console.warn('❌ Cannot update video state: not connected');
        console.warn('  isConnected:', isConnected, 'userId:', userId);
        return;
    }
    
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) {
        console.warn('❌ Cannot update video state: no videoPlayer');
        return;
    }
    
    if (!currentVideo) {
        console.warn('❌ Cannot update video state: no currentVideo');
        console.warn('  currentVideo:', currentVideo, 'userId:', userId);
        return;
    }
    
    // Debounce rapid updates - but ALWAYS allow custom controls to sync
    const now = Date.now();
    if (action === 'play' || action === 'pause') {
        // Only debounce if it's the same action very quickly (within 100ms)
        // Always allow different actions or slower repeats (for viewer controls)
        const timeSinceLastUpdate = now - lastStateUpdateTime;
        const isSameAction = lastVideoState && lastVideoState.action === action;
        if (timeSinceLastUpdate < 100 && isSameAction) {
            console.log('⏭️ Debouncing rapid same action update (within 100ms)');
            return;
        }
    } else if (action === 'timeupdate') {
        // For timeupdate, only send every 1000ms (1 second) to reduce frequency
        if (now - lastStateUpdateTime < 1000) {
            return;
        }
    }
    
    const newTime = time !== null ? time : videoPlayer.currentTime;
    // Use override if provided, otherwise calculate based on action or current state
    const isPlaying = overrideIsPlaying !== null 
        ? overrideIsPlaying 
        : (action === 'play' ? true : (action === 'pause' ? false : !videoPlayer.paused));
    
    const videoState = {
        videoId: currentVideo.id,
        currentTime: newTime,
        action: action,
        isPlaying: isPlaying,
        lastUpdatedBy: userId,
        timestamp: now
    };
    
    // CRITICAL: Update local state BEFORE emitting
    // This ensures timeupdate knows about pause/play and won't override
    lastVideoState = videoState;
    lastStateUpdateTime = now;
    
    // CRITICAL: For pause/play actions, immediately stop any pending timeupdate
    // This prevents timeupdate from overriding pause/play
    if (action === 'pause' || action === 'play') {
        console.log('⛔ BLOCKING timeupdate for 2 seconds after', action, 'to prevent override');
        // The timeupdate handler already checks for recent pause/play actions
    }
    
    console.log('📤 FREE-FOR-ALL: Emitting video-state-update to server:');
    console.log('  ✓ User:', userId, '(uploader OR viewer)');
    console.log('  ✓ Room:', currentRoom);
    console.log('  ✓ Action:', action);
    console.log('  ✓ CurrentTime:', newTime);
    console.log('  ✓ IsPlaying:', isPlaying);
    console.log('  ✓ VideoId:', currentVideo.id);
    console.log('  ✓ Socket connected:', isConnected);
    console.log('  ✓ Socket object:', !!socket);
    
    // CRITICAL: Emit to server - This works for UPLOADER AND VIEWER
    // Use MULTIPLE methods to ensure it gets through
    const emitData = {
        roomCode: currentRoom,
        videoState: videoState
    };
    
    console.log('🚀 ATTEMPTING TO EMIT - Full emit data:', JSON.stringify(emitData, null, 2));
    console.log('   Socket connected:', socket?.connected);
    console.log('   Socket ID:', socket?.id);
    console.log('   isConnected flag:', isConnected);
    
    try {
        // Method 1: Standard emit
        socket.emit('video-state-update', emitData);
        console.log('✅ Method 1: Standard emit() called');
        
        // Method 2: Emit with callback to verify
        socket.emit('video-state-update', emitData, (response) => {
            if (response) {
                console.log('✅ Method 2: Server acknowledged:', response);
            } else {
                console.warn('⚠️ Method 2: No server acknowledgment');
            }
        });
        
        // Method 3: Force emit with timeout (fallback)
        setTimeout(() => {
            if (socket && socket.connected) {
                console.log('🔄 Method 3: Retry emit (fallback)');
                socket.emit('video-state-update', emitData);
            }
        }, 50);
        
        console.log('✅ FREE-FOR-ALL: All emit methods attempted from user:', userId);
    } catch (error) {
        console.error('❌ ERROR emitting video-state-update:', error);
        console.error('  Error stack:', error.stack);
        console.error('  User:', userId, 'Room:', currentRoom, 'Action:', action);
        
        // Last resort: Try to reconnect and emit
        if (!socket || !socket.connected) {
            console.error('⚠️ Socket not connected, attempting reconnect...');
            connectToServer();
            setTimeout(() => {
                if (socket && socket.connected) {
                    socket.emit('video-state-update', emitData);
                    console.log('🔄 Reconnected and re-emitted');
                }
            }, 1000);
        }
    }
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
    console.log('🎬🎬🎬 applyVideoState() CALLED');
    console.log('   VideoState:', JSON.stringify(videoState, null, 2));
    console.log('   My userId:', userId);
    console.log('   CurrentRoom:', currentRoom);
    console.log('   CurrentVideo:', currentVideo?.id);
    
    if (!videoState) {
        console.error('❌ applyVideoState called with no videoState');
        return;
    }
    
    // Don't sync if we were the one who made the change
    if (videoState.lastUpdatedBy === userId) {
        console.log('⚠️ Ignoring own video state update in applyVideoState');
        console.log('   lastUpdatedBy:', videoState.lastUpdatedBy, '=== userId:', userId);
        return;
    }
    
    console.log('✅ Not our own update, proceeding to apply...');
    
    // Ignore stale updates (older than what we've already applied) - but allow same timestamp or newer
    if (videoState.timestamp && videoState.timestamp < lastReceivedStateTimestamp) {
        console.log('Ignoring stale state update:', videoState.timestamp, 'vs', lastReceivedStateTimestamp);
        return;
    }
    lastReceivedStateTimestamp = Math.max(lastReceivedStateTimestamp, videoState.timestamp || Date.now());
    
    // CRITICAL: For pause/play actions, ALWAYS apply immediately - ignore isSyncing
    const isCriticalAction = videoState.action === 'play' || videoState.action === 'pause';
    
    if (isCriticalAction) {
        console.log('🚨🚨🚨 CRITICAL ACTION (play/pause) - FORCING IMMEDIATE PROCESSING');
        console.log('   Action:', videoState.action, 'from user:', videoState.lastUpdatedBy);
        console.log('   isSyncing was:', isSyncing);
        
        // FORCE clear isSyncing for critical actions
        isSyncing = false;
        pendingStateUpdate = null;
        
        // Apply immediately - no delays
        console.log('   → Applying immediately (bypassing isSyncing check)');
    } else if (isSyncing) {
        // For non-critical actions, check if we should queue
        const isImportantAction = videoState.action === 'seek';
        
        if (isImportantAction) {
            console.log('🚨 Important action (seek) received while syncing, forcing immediate processing');
            isSyncing = false;
            pendingStateUpdate = null;
            setTimeout(() => {
                if (videoState.lastUpdatedBy !== userId && videoState.lastUpdatedBy) {
                    console.log('🚨 Applying seek action immediately');
                    applyVideoState(videoState);
                }
            }, 30);
            return;
        } else {
            // For timeupdate while syncing, queue it (low priority)
            console.log('Already syncing, queuing timeupdate. Timestamp:', videoState.timestamp);
            pendingStateUpdate = videoState;
            setTimeout(() => {
                if (pendingStateUpdate && pendingStateUpdate === videoState) {
                    console.log('Processing queued timeupdate after delay');
                    pendingStateUpdate = null;
                    applyVideoState(videoState);
                }
            }, 500);
            return;
        }
    }
    
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer || !currentVideo) {
        console.warn('Cannot apply video state: no player or current video');
        return;
    }
    
    // Don't sync if it's a different video
    if (videoState.videoId && currentVideo.id !== videoState.videoId) {
        console.log('Video ID mismatch, ignoring state update');
        return;
    }
    
    // Check if video is ready
    if (videoPlayer.readyState < 2) {
        console.log('Video not ready, waiting...');
        const applyWhenReady = () => {
            if (videoPlayer.readyState >= 2) {
                applyVideoState(videoState);
            } else {
                setTimeout(applyWhenReady, 100);
            }
        };
        setTimeout(applyWhenReady, 100);
        return;
    }
    
    isSyncing = true;
    console.log('Applying video state:', videoState, 'Action:', videoState.action);
    
    const timeDiff = Math.abs(videoPlayer.currentTime - videoState.currentTime);
    
    if (videoState.action === 'timeupdate') {
        // CRITICAL: timeupdate should NEVER override pause/play state
        // If video is paused, ALWAYS ignore timeupdate - respect the pause state
        if (videoPlayer.paused) {
            console.log('⛔ Ignoring timeupdate - video is paused, respecting pause state');
            isSyncing = false;
            return; // Don't sync timeupdate when paused - let user control their pause
        }
        
        // CRITICAL: Check if a pause/play happened recently (within 3 seconds)
        // If so, ignore timeupdate to prevent it from overriding pause/play
        const lastAction = lastVideoState?.action;
        const timeSinceLastAction = lastVideoState ? Date.now() - (lastVideoState.timestamp || 0) : Infinity;
        
        if ((lastAction === 'pause' || lastAction === 'play') && timeSinceLastAction < 3000) {
            console.log('⛔ Ignoring timeupdate - pause/play action occurred recently (', timeSinceLastAction, 'ms ago)');
            isSyncing = false;
            return; // Don't let timeupdate override recent pause/play
        }
        
        // Only sync time if video is playing and difference is significant
        const timeThreshold = 1.5; // Increased threshold to reduce sync frequency
        if (timeDiff > timeThreshold) {
            console.log(`Syncing timeupdate: ${videoPlayer.currentTime.toFixed(2)} -> ${videoState.currentTime.toFixed(2)} (diff: ${timeDiff.toFixed(2)}s)`);
            videoPlayer.currentTime = videoState.currentTime;
            // Don't apply play/pause state for timeupdate - just finish sync
            setTimeout(() => {
                isSyncing = false;
                updatePlayPauseButton(); // Update button UI but don't change playback state
            }, 50);
        } else {
            // Time is close enough, just finish without changing anything
            isSyncing = false;
        }
        return; // Early return - don't apply play/pause state for timeupdate
    }
    
    if (videoState.action === 'seek') {
        // Always sync time for seek actions, even if difference is small
        console.log(`Syncing seek: ${videoPlayer.currentTime.toFixed(2)} -> ${videoState.currentTime.toFixed(2)} (diff: ${timeDiff.toFixed(2)}s)`);
        videoPlayer.currentTime = videoState.currentTime;
        // Wait for seek to complete, then apply play/pause state if needed
        setTimeout(() => {
            applyPlayPauseState(videoState);
        }, 100);
    } else {
        // For play/pause actions, sync time only if difference is significant
        const timeThreshold = 0.3; // Smaller threshold for play/pause
        if (timeDiff > timeThreshold) {
            console.log(`Syncing time: ${videoPlayer.currentTime.toFixed(2)} -> ${videoState.currentTime.toFixed(2)} (diff: ${timeDiff.toFixed(2)}s)`);
            videoPlayer.currentTime = videoState.currentTime;
            // Wait a moment for time to update
            setTimeout(() => {
                applyPlayPauseState(videoState);
            }, 50);
        } else {
            applyPlayPauseState(videoState);
        }
    }
}

// Helper function to apply play/pause state
function applyPlayPauseState(videoState) {
    const videoPlayer = document.getElementById('videoPlayer');
    if (!videoPlayer) {
        isSyncing = false;
        return;
    }
    
    // Use isPlaying field to determine state, or infer from action
    const shouldBePlaying = videoState.isPlaying !== undefined 
        ? videoState.isPlaying 
        : (videoState.action === 'play');
    
    console.log('🎬 Applying play/pause state. Action:', videoState.action, 'Should be playing:', shouldBePlaying, 'Currently paused:', videoPlayer.paused);
    console.log('   From user:', videoState.lastUpdatedBy, 'My userId:', userId);
    console.log('   VideoState.isPlaying:', videoState.isPlaying);
    
    // CRITICAL: For pause action, ALWAYS pause regardless of isPlaying field
    if (videoState.action === 'pause') {
        console.log('⏸️ PAUSE ACTION DETECTED - Forcing pause immediately');
        if (!videoPlayer.paused) {
            videoPlayer.pause();
            console.log('✅ Video paused successfully');
        } else {
            console.log('✅ Video already paused');
        }
        updatePlayPauseButton();
        finishSync();
        return;
    }
    
    // Sync play/pause state based on isPlaying field (works for all action types)
    if (shouldBePlaying && videoPlayer.paused) {
        console.log('▶️ Syncing play (video should be playing but is paused)');
        const playPromise = videoPlayer.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('✅ Play synced successfully');
                    updatePlayPauseButton();
                    finishSync();
                })
                .catch(e => {
                    console.error('❌ Play failed during sync:', e);
                    finishSync();
                });
        } else {
            updatePlayPauseButton();
            finishSync();
        }
    } else if (!shouldBePlaying && !videoPlayer.paused) {
        console.log('⏸️ Syncing pause (video should be paused but is playing)');
        console.log('   Action:', videoState.action, 'isPlaying:', videoState.isPlaying);
        videoPlayer.pause();
        console.log('✅ Video paused successfully via applyPlayPauseState');
        updatePlayPauseButton();
        finishSync();
    } else {
        // Already in correct state
        console.log('Play/pause state already correct');
        updatePlayPauseButton();
        finishSync();
    }
}

// Helper function to finish sync and handle pending updates
function finishSync() {
    // Update room status
    updateRoomStatus();
    
    // Process pending update if any - prioritize this over resetting isSyncing
    if (pendingStateUpdate) {
        const pending = pendingStateUpdate;
        pendingStateUpdate = null;
        console.log('Processing pending update after sync finished. Action:', pending.action);
        setTimeout(() => {
            // Apply the pending update even if isSyncing is still true
            const wasSyncing = isSyncing;
            isSyncing = false;
            applyVideoState(pending);
            // Keep isSyncing false after applying pending update
            setTimeout(() => {
                isSyncing = false;
            }, 100);
        }, 50);
    } else {
        // Reset sync flag after a delay
        setTimeout(() => {
            isSyncing = false;
            console.log('Sync finished, isSyncing reset to false');
        }, 100);
    }
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

// ============ STORAGE MANAGEMENT ============

// Check storage info
async function checkStorage() {
    const storageInfo = document.getElementById('storageInfo');
    if (!storageInfo) return;
    
    storageInfo.innerHTML = '<p style="color: #e0e0e0;">Loading storage information...</p>';
    
    try {
        const response = await fetch(`${SERVER_URL}/api/admin/storage`);
        const data = await response.json();
        
        if (data.success) {
            storageInfo.innerHTML = `
                <h3 style="color: #7a8d52; margin-bottom: 1rem;">📊 Storage Statistics</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
                    <div style="background: #1f1f1f; padding: 1rem; border-radius: 8px;">
                        <div style="color: #b0b0b0; font-size: 0.9rem; margin-bottom: 0.5rem;">Total Files</div>
                        <div style="color: #e0e0e0; font-size: 1.5rem; font-weight: bold;">${data.totalFiles}</div>
                    </div>
                    <div style="background: #1f1f1f; padding: 1rem; border-radius: 8px;">
                        <div style="color: #b0b0b0; font-size: 0.9rem; margin-bottom: 0.5rem;">Total Size</div>
                        <div style="color: #e0e0e0; font-size: 1.5rem; font-weight: bold;">${data.totalSizeFormatted}</div>
                    </div>
                </div>
                ${data.totalFiles > 0 ? `
                    <details style="margin-top: 1rem;">
                        <summary style="color: #7a8d52; cursor: pointer; padding: 0.5rem; background: #1f1f1f; border-radius: 5px;">
                            View All Files (${data.totalFiles})
                        </summary>
                        <div style="margin-top: 1rem; max-height: 300px; overflow-y: auto;">
                            ${data.files.map(file => `
                                <div style="padding: 0.8rem; margin-bottom: 0.5rem; background: #1f1f1f; border-radius: 5px; border-left: 3px solid #5d6e2e;">
                                    <div style="color: #e0e0e0; font-weight: 500; margin-bottom: 0.3rem;">${file.filename}</div>
                                    <div style="display: flex; justify-content: space-between; color: #b0b0b0; font-size: 0.85rem;">
                                        <span>${file.sizeFormatted}</span>
                                        <span>${new Date(file.created).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : '<p style="color: #b0b0b0; margin-top: 1rem;">No files uploaded yet.</p>'}
            `;
        } else {
            storageInfo.innerHTML = `<p style="color: #ff4444;">Error: ${data.error || 'Failed to load storage info'}</p>`;
        }
    } catch (error) {
        storageInfo.innerHTML = `<p style="color: #ff4444;">Error loading storage info: ${error.message}</p>`;
    }
}

// Cleanup old files
async function cleanupOldFiles(days) {
    if (!confirm(`Are you sure you want to delete all files older than ${days} days? This cannot be undone!`)) {
        return;
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/admin/cleanup?days=${days}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.message}\n\nDeleted: ${data.deletedCount} file(s)\nFreed up: ${data.deletedSizeFormatted}`);
            // Refresh storage info
            checkStorage();
        } else {
            alert(`❌ Error: ${data.error || 'Failed to cleanup files'}`);
        }
    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    }
}

// Cleanup all files
async function cleanupAllFiles() {
    if (!confirm('⚠️ WARNING: This will delete ALL uploaded files!\n\nThis cannot be undone. Are you absolutely sure?')) {
        return;
    }
    
    // Double confirmation
    if (!confirm('This is your last chance! Are you 100% sure you want to delete ALL files?')) {
        return;
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/admin/cleanup-all`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.message}\n\nDeleted: ${data.deletedCount} file(s)\nFreed up: ${data.deletedSizeFormatted}`);
            // Refresh storage info
            checkStorage();
        } else {
            alert(`❌ Error: ${data.error || 'Failed to delete files'}`);
        }
    } catch (error) {
        alert(`❌ Error: ${error.message}`);
    }
}

// Check storage info when page loads (if on admin section)
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the admin section
    if (window.location.hash === '#admin') {
        setTimeout(checkStorage, 500);
    }
});
