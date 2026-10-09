// server/middleware/read-image.js
// Reads a raw image body (JPEG, PNG or WebP, 2 MB at most) into req.body
// as a Buffer. Uploads skip the JSON-only rule through BINARY_UPLOADS in
// require-json.js; the service then checks the bytes themselves.

const express = require('express');
const { AppError, ErrorCodes } = require('../utils/errors');
const { IMAGE_TYPES } = require('../utils/images');

const parseImage = express.raw({ type: IMAGE_TYPES, limit: '2mb' });

function readImage() {
  return (req, res, next) => {
    parseImage(req, res, (err) => {
      if (!err) return next();
      if (err.type === 'entity.too.large') {
        return next(new AppError(ErrorCodes.VALIDATION_ERROR, 'The picture is too large (2 MB at most)', 413));
      }
      return next(new AppError(ErrorCodes.VALIDATION_ERROR, 'Could not read that image', 400));
    });
  };
}

module.exports = { readImage };
