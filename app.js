// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Storage configuration for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mp3|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('File type not allowed'));
        }
    }
});

// Data storage
let users = [];
let messages = [];
let onlineUsers = new Map(); // socketId -> {username, room}
let roomUsers = new Map(); // room -> Set of usernames
let typingUsers = new Map(); // room -> Set of usernames

// Initialize rooms
const ROOMS = ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5'];
ROOMS.forEach(room => {
    roomUsers.set(room, new Set());
    typingUsers.set(room, new Set());
});

// Load data from JSON files
function loadData() {
    try {
        if (fs.existsSync('users.json')) {
            users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
        }
        if (fs.existsSync('messages.json')) {
            messages = JSON.parse(fs.readFileSync('messages.json', 'utf8'));
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Save data to JSON files
function saveData() {
    try {
        fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
        fs.writeFileSync('messages.json', JSON.stringify(messages, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Load initial data
loadData();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// API Routes
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (users.find(user => user.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    const newUser = {
        id: Date.now().toString(),
        username,
        password,
        createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    saveData();
    
    res.json({ success: true, message: 'User created successfully' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username && u.password === password);
    
    if (!user) {
        return res.status(400).json({ error: 'Invalid username or password' });
    }
    
    res.json({ success: true, user: { id: user.id, username: user.username } });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: `/uploads/${req.file.filename}`
    });
});

app.get('/api/messages/:room', (req, res) => {
    const room = req.params.room;
    const roomMessages = messages.filter(msg => msg.room === room);
    res.json(roomMessages);
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    socket.on('join-room', (data) => {
        const { username, room } = data;
        
        // Check room capacity
        if (roomUsers.get(room).size >= 100) {
            socket.emit('room-full');
            return;
        }
        
        // Leave previous room if any
        const previousData = onlineUsers.get(socket.id);
        if (previousData) {
            socket.leave(previousData.room);
            roomUsers.get(previousData.room).delete(previousData.username);
            typingUsers.get(previousData.room).delete(previousData.username);
            
            // Notify previous room about user leaving
            socket.to(previousData.room).emit('user-left', {
                username: previousData.username,
                userCount: roomUsers.get(previousData.room).size
            });
            
            io.to(previousData.room).emit('typing-update', {
                typingUsers: Array.from(typingUsers.get(previousData.room))
            });
        }
        
        // Join new room
        socket.join(room);
        onlineUsers.set(socket.id, { username, room });
        roomUsers.get(room).add(username);
        
        // Send room messages to user
        const roomMessages = messages.filter(msg => msg.room === room);
        socket.emit('room-messages', roomMessages);
        
        // Notify room about new user
        socket.to(room).emit('user-joined', {
            username,
            userCount: roomUsers.get(room).size
        });
        
        // Send current user count to the joining user
        socket.emit('user-count', roomUsers.get(room).size);
        
        console.log(`${username} joined ${room}`);
    });
    
    socket.on('send-message', (data) => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;
        
        const message = {
            id: Date.now().toString(),
            username: userData.username,
            room: userData.room,
            content: data.content,
            type: data.type || 'text',
            file: data.file || null,
            timestamp: new Date().toISOString()
        };
        
        messages.push(message);
        saveData();
        
        // Broadcast message to room
        io.to(userData.room).emit('new-message', message);
    });
    
    socket.on('typing', () => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;
        
        typingUsers.get(userData.room).add(userData.username);
        socket.to(userData.room).emit('typing-update', {
            typingUsers: Array.from(typingUsers.get(userData.room))
        });
    });
    
    socket.on('stop-typing', () => {
        const userData = onlineUsers.get(socket.id);
        if (!userData) return;
        
        typingUsers.get(userData.room).delete(userData.username);
        socket.to(userData.room).emit('typing-update', {
            typingUsers: Array.from(typingUsers.get(userData.room))
        });
    });
    
    socket.on('disconnect', () => {
        const userData = onlineUsers.get(socket.id);
        if (userData) {
            roomUsers.get(userData.room).delete(userData.username);
            typingUsers.get(userData.room).delete(userData.username);
            
            // Notify room about user leaving
            socket.to(userData.room).emit('user-left', {
                username: userData.username,
                userCount: roomUsers.get(userData.room).size
            });
            
            io.to(userData.room).emit('typing-update', {
                typingUsers: Array.from(typingUsers.get(userData.room))
            });
            
            onlineUsers.delete(socket.id);
            console.log(`${userData.username} left ${userData.room}`);
        }
        
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Save data periodically
setInterval(saveData, 30000); // Save every 30 seconds
