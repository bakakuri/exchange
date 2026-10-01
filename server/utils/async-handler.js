// server/utils/async-handler.js
// Wraps an async Express handler so a rejected promise reaches the error
// handler via next(err) instead of crashing the process (Express 4 does
// not do this automatically). Every async middleware and controller
// uses this instead of its own try/catch boilerplate.

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
