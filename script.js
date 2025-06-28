let token = localStorage.getItem('token');
let username = '';
let currentRoom = '';
let socket = null;

function showLoginPopup() {
    document.getElementById('loginPopup').style.display = 'block';
}

function closeLoginPopup() {
    document.getElementById('loginPopup').style.display = 'none';
}

function signup() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    fetch('/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    }).then(res => {
        if (res.ok) {
            alert('Signup berhasil, silakan login.');
        } else {
            alert('Username sudah terdaftar.');
        }
    });
}

function login() {
    const uname = document.getElementById('username').value;
    const pwd = document.getElementById('password').value;

    fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname, password: pwd })
    }).then(res => res.json()).then(data => {
        if (data.token) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('username', uname);
            location.reload();
        } else {
            alert('Login gagal.');
        }
    });
}

function enterRoom(room) {
    if (!localStorage.getItem('token')) {
        alert('Anda harus login terlebih dahulu.');
        return;
    }
    localStorage.setItem('room', room);
    window.location.href = 'chat.html';
}

if (window.location.pathname.includes('chat.html')) {
    username = localStorage.getItem('username');
    currentRoom = localStorage.getItem('room');

    document.getElementById('roomName').innerText = `Chat - ${currentRoom}`;
    socket = io();

    socket.emit('joinRoom', { room: currentRoom, username });

    socket.on('roomFull', () => {
        alert('Room sudah penuh!');
        window.location.href = 'index.html';
    });

    socket.on('blocked', () => {
        alert('Anda diblokir oleh admin.');
        window.location.href = 'index.html';
    });

    socket.on('userJoined', (msg) => {
        const notif = document.createElement('div');
        notif.innerText = msg;
        document.getElementById('notifications').appendChild(notif);
    });

    socket.on('userLeft', (msg) => {
        const notif = document.createElement('div');
        notif.innerText = msg;
        document.getElementById('notifications').appendChild(notif);
    });

    socket.on('updateUsers', (users) => {
        document.getElementById('usersOnline').innerText = `User Online: ${users.length}`;
    });

    socket.on('loadMessages', (msgs) => {
        const chatBox = document.getElementById('chatBox');
        chatBox.innerHTML = '';
        msgs.forEach(msg => {
            const msgElem = document.createElement('div');
            if (msg.type === 'text') {
                msgElem.innerText = `${msg.username}: ${msg.content}`;
            } else {
                msgElem.innerHTML = `${msg.username}: <img src="${msg.content}" width="150"/>`;
            }
            chatBox.appendChild(msgElem);
        });
    });

    socket.on('receiveMessage', (msg) => {
        const chatBox = document.getElementById('chatBox');
        const msgElem = document.createElement('div');
        if (msg.type === 'text') {
            msgElem.innerText = `${msg.username}: ${msg.content}`;
        } else {
            msgElem.innerHTML = `${msg.username}: <img src="${msg.content}" width="150"/>`;
        }
        chatBox.appendChild(msgElem);
    });

    socket.on('userTyping', (msg) => {
        document.getElementById('typingStatus').innerText = msg;
        setTimeout(() => {
            document.getElementById('typingStatus').innerText = '';
        }, 2000);
    });
}

function typing() {
    socket.emit('typing');
}

function sendMessage() {
    const message = document.getElementById('messageInput').value;
    const fileInput = document.getElementById('mediaInput');
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = () => {
            socket.emit('sendMessage', { content: reader.result, type: 'media' });
        };
        reader.readAsDataURL(file);
    } else if (message.trim() !== '') {
        socket.emit('sendMessage', { content: message, type: 'text' });
        document.getElementById('messageInput').value = '';
    }
}

function logout() {
    localStorage.clear();
    window.location.href = 'index.html';
}
