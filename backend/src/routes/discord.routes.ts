import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Discord API routes' });
});

export const discordRoutes = router; 