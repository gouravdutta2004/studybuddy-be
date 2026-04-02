const createRoom = async (req, res) => {
  try {
    const API_KEY = process.env.DAILY_API_KEY;
    if (!API_KEY) {
      console.warn("DAILY_API_KEY not set in .env. Using fallback test room.");
      return res.json({ url: 'https://studyfriend-demo.daily.co/test-room' });
    }
    
    // Create a Daily.co room
    const response = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
            properties: {
                exp: Math.floor(Date.now() / 1000) + 86400, // Expires in 24 hours
            }
        })
    });
    
    if (!response.ok) {
        throw new Error('Failed to create Daily.co room');
    }

    const room = await response.json();
    res.json({ url: room.url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createRoom };
