const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// POST /api/calendly/confirm endpoint
app.post('/api/calendly/confirm', async (req, res) => {
  try {
    const { eventUri } = req.body;
    if (!eventUri) {
      return res.status(400).json({ error: 'eventUri is required' });
    }

    const token = process.env.CALENDLY_API_TOKEN;
    if (!token || token === 'your_calendly_personal_access_token_here') {
      console.warn('[Calendly API Warning] CALENDLY_API_TOKEN is missing or unconfigured in .env');
      return res.status(400).json({ 
        error: 'CALENDLY_API_TOKEN is missing in .env', 
        fallback: true 
      });
    }

    // Extract event UUID from the end of eventUri
    // Example: "https://api.calendly.com/scheduled_events/12345678-abcd-1234-abcd-1234567890ab" -> "12345678-abcd-1234-abcd-1234567890ab"
    const uuid = eventUri.split('/').filter(Boolean).pop();
    const calendlyApiUrl = `https://api.calendly.com/scheduled_events/${uuid}`;

    const response = await fetch(calendlyApiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Calendly REST API Error] Status ${response.status}: ${errorText}`);
      return res.status(response.status).json({ 
        error: `Calendly API error (${response.status})`, 
        fallback: true 
      });
    }

    const data = await response.json();
    const resource = data.resource;

    if (!resource || !resource.start_time) {
      return res.status(404).json({ error: 'Scheduled event details not found', fallback: true });
    }

    return res.json({
      success: true,
      start_time: resource.start_time,
      end_time: resource.end_time,
      name: resource.name,
      status: resource.status
    });

  } catch (error) {
    console.error('[Server Error]', error);
    return res.status(500).json({ error: 'Internal server error', fallback: true });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
