// server/middleware/validation.js
// Generic request-validation middleware. Each route supplies a validator
// function (from validators/*.validator.js) that inspects req.body and
// returns a list of human-readable problems; a non-empty list becomes
// one VALIDATION_ERROR response, so no controller hand-rolls input
// checks and no bad input ever reaches a service or the database.

const { AppError, ErrorCodes } = require('../utils/errors');

function validate(validatorFn) {
  return (req, res, next) => {
    const errors = validatorFn(req.body || {});
    if (errors && errors.length > 0) {
      return next(new AppError(ErrorCodes.VALIDATION_ERROR, errors.join('; '), 400));
    }
    next();
  };
}

module.exports = { validate };
