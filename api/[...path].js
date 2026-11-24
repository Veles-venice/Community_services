'use strict';
// Vercel serverless entry: every /api/* request is handled by the same code as `npm start`.
const { handler } = require('../server');
module.exports = (req, res) => handler(req, res);
