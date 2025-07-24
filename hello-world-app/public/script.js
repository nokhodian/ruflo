// Fetch initial hello message when page loads
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/hello');
        const data = await response.json();
        console.log('Initial hello response:', data);
    } catch (error) {
        console.error('Error fetching hello:', error);
    }
});

// Get personalized greeting
async function getGreeting() {
    const nameInput = document.getElementById('nameInput');
    const responseBox = document.getElementById('response');
    const name = nameInput.value.trim();

    if (!name) {
        showResponse('Please enter your name!', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/greeting/${encodeURIComponent(name)}`);
        const data = await response.json();
        showResponse(data.message, 'success');
    } catch (error) {
        showResponse('Error connecting to the server!', 'error');
    }
}

// Display response with animation
function showResponse(message, type) {
    const responseBox = document.getElementById('response');
    responseBox.textContent = message;
    responseBox.className = 'response-box show';
    
    if (type === 'error') {
        responseBox.style.background = '#fed7d7';
        responseBox.style.color = '#c53030';
    } else {
        responseBox.style.background = '#f0fff4';
        responseBox.style.color = '#276749';
    }
}

// Allow Enter key to submit
document.getElementById('nameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        getGreeting();
    }
});