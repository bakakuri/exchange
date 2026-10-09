// server/controllers/messages.controller.js
const { asyncHandler } = require('../utils/async-handler');
const messagesService = require('../services/messages.service');

const listConversations = asyncHandler(async (req, res) => {
  res.json(await messagesService.listConversations(req.accessToken, req.query));
});

const startConversation = asyncHandler(async (req, res) => {
  res.status(201).json(await messagesService.startConversation(req.accessToken, req.body));
});

const getConversation = asyncHandler(async (req, res) => {
  res.json(await messagesService.getConversation(req.accessToken, req.params.id, req.query));
});

const createUpload = asyncHandler(async (req, res) => {
  res.status(201).json(await messagesService.createUpload(req.accessToken, req.params.id, req.user.id, req.body));
});

const send = asyncHandler(async (req, res) => {
  res.status(201).json(await messagesService.send(req.accessToken, req.params.id, req.body));
});

const markRead = asyncHandler(async (req, res) => {
  res.json(await messagesService.markRead(req.accessToken, req.params.id, req.body.seq));
});

const remove = asyncHandler(async (req, res) => {
  await messagesService.remove(req.accessToken, req.params.id);
  res.status(204).end();
});

const updates = asyncHandler(async (req, res) => {
  const { since, conversation, after } = req.query;
  res.json(await messagesService.updates(req.accessToken, { since, conversation, after }));
});

const block = asyncHandler(async (req, res) => {
  await messagesService.block(req.accessToken, req.body.user_id);
  res.status(204).end();
});

const unblock = asyncHandler(async (req, res) => {
  await messagesService.unblock(req.accessToken, req.params.userId);
  res.status(204).end();
});

module.exports = { listConversations, startConversation, getConversation, createUpload, send, markRead, remove, updates, block, unblock };
