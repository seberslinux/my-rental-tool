const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const { getOne, run } = require('../db/database');

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getOne(
      'SELECT id, email, name, role, avatar_url, active FROM users WHERE id = $1 AND active = 1',
      [id]
    );
    done(null, user || false);
  } catch (err) { done(err); }
});

// Local strategy (email + password)
passport.use(new LocalStrategy(
  { usernameField: 'email' },
  async (email, password, done) => {
    try {
      const user = await getOne('SELECT * FROM users WHERE email = $1 AND active = 1', [email]);
      if (!user) return done(null, false, { message: 'Invalid credentials' });
      if (!user.password_hash) return done(null, false, { message: 'Please use Google login for this account' });
      if (!bcrypt.compareSync(password, user.password_hash)) {
        return done(null, false, { message: 'Invalid credentials' });
      }
      done(null, user);
    } catch (err) { done(err); }
  }
));

// Google strategy (only if configured)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const googleId = profile.id;
      const email = profile.emails?.[0]?.value;

      // Look up by google_id first
      let user = await getOne('SELECT * FROM users WHERE google_id = $1 AND active = 1', [googleId]);
      if (user) return done(null, user);

      // Look up by email and link Google account
      if (email) {
        user = await getOne('SELECT * FROM users WHERE email = $1 AND active = 1', [email]);
        if (user) {
          await run(
            'UPDATE users SET google_id = $1, avatar_url = $2, updated_at = NOW() WHERE id = $3',
            [googleId, profile.photos?.[0]?.value || '', user.id]
          );
          return done(null, user);
        }
      }

      // No matching user — admin must pre-create account
      done(null, false, { message: 'No account exists for this email. Contact your admin.' });
    } catch (err) { done(err); }
  }));
}

module.exports = passport;
