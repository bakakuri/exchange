// server/validators/members.validator.js
// The members directory's query string (GET /api/members). Pure function:
// query in, { errors, filters } out - unknown values are refused rather
// than silently ignored, so a typo in a link shows up as an error.

const { MEMBER_CATEGORIES, MEMBER_SEGMENTS, MEMBER_SORTS } = require('../constants/member-categories');

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
const MAX_OFFSET = 10_000;

function parseDirectoryQuery(query = {}) {
  const errors = [];
  const filters = { search: null, category: null, segment: null, sort: null, limit: PAGE_SIZE, offset: 0 };

  if (query.search != null && String(query.search).trim()) {
    const search = String(query.search).trim();
    if (search.length > 60) errors.push('search must be 60 characters or fewer');
    else filters.search = search;
  }
  if (query.category) {
    if (MEMBER_CATEGORIES.includes(query.category)) filters.category = query.category;
    else errors.push(`category must be one of: ${MEMBER_CATEGORIES.join(', ')}`);
  }
  if (query.segment) {
    if (MEMBER_SEGMENTS.includes(query.segment)) filters.segment = query.segment;
    else errors.push(`segment must be one of: ${MEMBER_SEGMENTS.join(', ')}`);
  }
  if (query.sort) {
    if (MEMBER_SORTS.includes(query.sort)) filters.sort = query.sort;
    else errors.push(`sort must be one of: ${MEMBER_SORTS.join(', ')}`);
  }
  if (query.limit != null) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) errors.push(`limit must be 1-${MAX_PAGE_SIZE}`);
    else filters.limit = limit;
  }
  if (query.offset != null) {
    const offset = Number(query.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) errors.push(`offset must be 0-${MAX_OFFSET}`);
    else filters.offset = offset;
  }
  return { errors, filters };
}

module.exports = { parseDirectoryQuery, PAGE_SIZE };
