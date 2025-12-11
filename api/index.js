// Vercel serverless function wrapper for Express app
import app from '../dist/src/index.js';

export default async (req, res) => {
  return app(req, res);
};
