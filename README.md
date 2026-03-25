# Veno-Arena Backend API

Backend API for Veno-Arena gaming platform.

## Features

- User authentication and profile management
- Veno Coins system with daily rewards
- League creation and management
- Team management
- Match results and standings

## API Endpoints

### Users
- `GET /api/users/:userId` - Get user profile
- `POST /api/users/:userId` - Create/update user

### Coins
- `GET /api/coins/:userId` - Get user coin balance
- `POST /api/coins/:userId/claim` - Claim daily reward

### Leagues
- `GET /api/leagues` - Get all leagues
- `GET /api/leagues/:leagueId` - Get single league
- `POST /api/leagues` - Create league
- `POST /api/leagues/:leagueId/join` - Join league

### Teams
- `GET /api/teams/:userId` - Get user's teams
- `POST /api/teams` - Create team

## Deployment

Deployed on Render: https://veno-arena-backend.onrender.com

## Environment Variables

- `FIREBASE_PROJECT_ID` - Firebase project ID
- `FIREBASE_CLIENT_EMAIL` - Firebase service account email
- `FIREBASE_PRIVATE_KEY` - Firebase private key

## Local Development

1. Clone the repository
2. Run `npm install`
3. Add `serviceAccountKey.json` from Firebase
4. Run `npm run dev`
5. Server runs on http://localhost:3000
