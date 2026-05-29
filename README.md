# RequestMe

A local Postman-like API client built with React + Node.js.

## Setup

```bash
npm install
npm install --prefix server
npm install --prefix client
```

## Run

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

## Features

- Organize requests into projects
- HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- Request headers editor with enable/disable
- Request body: JSON, form data, raw text
- Authentication: Bearer token, Basic auth, API Key (header or query param)
- Environment variables with `{{variable}}` substitution
- Response viewer: formatted JSON, raw, headers
