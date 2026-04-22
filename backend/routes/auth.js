const express    = require('express');
const router     = express.Router();
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const User       = require('../models/User');
const { protect: authMiddleware } = require('../middleware/auth');

const SUPPORTED_LANGS = ['en','hi','bn','te','mr','ta','gu','kn','ml','pa','or','as','ur'];

const sign   = id => jwt.sign({ id }, process.env.JWT_ACCESS_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '7d' });
// safe() returns the complete user profile the frontend needs.
// Expanded so nothing is silently missing after Google login / token refresh.
const safe   = u  => ({
  _id:             u._id,
  name:            u.name,
  email:           u.email,
  phone:           u.phone || null,
  hasGoogle:       !!u.googleId,
  surveyCompleted: !!u.surveyCompleted,
  language:        u.language || 'en',
  profileViews:    u.profileViews || 0,
  productCount:    u.productCount || 0,
  queryCount:      u.queryCount   || 0,
  createdAt:       u.createdAt,
  updatedAt:       u.updatedAt,
});
const mailer = () => nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });

// In-memory OTP store (use Redis in production)
const otpStore = new Map();

/* POST /api/auth/signup */
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, language } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'All fields are required.' });
    if (password.length < 8)          return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ message: 'An account with this email already exists.' });

    const lang = (language && SUPPORTED_LANGS.includes(language)) ? language : 'en';
    const user = await User.create({ name, email, password, language: lang });
    res.status(201).json({ token: sign(user._id), user: safe(user) });
  } catch (err) { console.error('[signup]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* POST /api/auth/login */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user)                                     return res.status(401).json({ message: 'Invalid email or password.' });
    if (!(await user.correctPassword(password))) return res.status(401).json({ message: 'Invalid email or password.' });
    res.json({ token: sign(user._id), user: safe(user) });
  } catch (err) { console.error('[login]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* POST /api/auth/send-otp */
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number is required.' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(phone, { otp, expires: Date.now() + 5 * 60 * 1000 });
    console.log(`[OTP] ${phone} -> ${otp}`);
    res.json({ message: 'OTP sent (dev mode: check server logs).' });
  } catch (err) { console.error('[send-otp]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* POST /api/auth/verify-otp */
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp, mode, name } = req.body;
    if (!phone || !otp) return res.status(400).json({ message: 'Phone and OTP are required.' });
    const entry = otpStore.get(phone);
    if (!entry || entry.expires < Date.now() || entry.otp !== otp)
      return res.status(401).json({ message: 'Invalid or expired OTP.' });
    otpStore.delete(phone);

    let user = await User.findOne({ phone });
    if (!user) {
      if (mode === 'signup') {
        user = await User.create({ name: name || `User${phone.slice(-4)}`, email: `${phone.replace(/\D/g,'')}@phone.retlify.in`, phone, password: crypto.randomBytes(16).toString('hex') });
      } else { return res.status(404).json({ message: 'No account with this number. Please sign up.' }); }
    }
    res.json({ token: sign(user._id), user: safe(user) });
  } catch (err) { console.error('[verify-otp]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* GET /api/auth/language */
router.get('/language', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('language');
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ language: user.language || 'en' });
  } catch (err) { console.error('[get-lang]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* PUT /api/auth/language */
router.put('/language', authMiddleware, async (req, res) => {
  try {
    const { language } = req.body;
    if (!language || !SUPPORTED_LANGS.includes(language))
      return res.status(400).json({ message: 'Invalid language code.' });

    await User.findByIdAndUpdate(req.user.id, { language }, { new: true });
    res.json({ language, message: 'Language preference saved.' });
  } catch (err) { console.error('[set-lang]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* GET /auth/google */
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect('/login.html?error=google_not_configured');
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${process.env.FRONTEND_URL || 'http://localhost:5000'}/auth/google/callback`,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/* GET /auth/google/callback */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error || !code) return res.redirect('/login.html?error=google_denied');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/auth/google/callback`, grant_type: 'authorization_code' }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/login.html?error=google_token_failed');
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const gUser = await userRes.json();
    if (!gUser.email) return res.redirect('/login.html?error=google_no_email');
    let user = await User.findOne({ email: gUser.email.toLowerCase() });
    if (!user) { user = await User.create({ name: gUser.name || gUser.email.split('@')[0], email: gUser.email.toLowerCase(), password: crypto.randomBytes(16).toString('hex'), googleId: gUser.id }); }
    else if (!user.googleId) { user.googleId = gUser.id; await user.save({ validateBeforeSave: false }); }
    const token = sign(user._id);
    const dest  = user.surveyCompleted ? 'dashboard.html' : 'survey.html';
    const safeUser = JSON.stringify(safe(user)).replace(/'/g, "\\'");

    // Inject language + full profile into localStorage. Dashboard also re-fetches
    // /api/auth/me on load to guarantee freshness.
    res.send(`
<script>
  localStorage.setItem('token','${token}');
  localStorage.setItem('user','${safeUser}');
  localStorage.setItem('retlify_lang','${user.language || 'en'}');
  window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:5000'}/${dest}';
</script>`);
  } catch (err) { console.error('[google-cb]', err); res.redirect('/login.html?error=google_failed'); }
});

/* POST /api/auth/forgot-password */
router.post('/forgot-password', async (req, res) => {
  const GENERIC = 'If this email exists, a reset link has been sent.';
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ message: GENERIC });
    const raw = crypto.randomBytes(32).toString('hex');
    user.resetToken       = crypto.createHash('sha256').update(raw).digest('hex');
    user.resetTokenExpiry = Date.now() + 3600000;
    await user.save({ validateBeforeSave: false });
    const url = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/reset-password.html?token=${raw}`;
    try {
      await mailer().sendMail({ from: `"Retlify" <${process.env.EMAIL_USER}>`, to: user.email, subject: 'Reset your Retlify password',
        html: `<div style="font-family:sans-serif;max-width:500px;margin:40px auto;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB"><div style="background:#1a1d23;padding:24px 32px"><b style="color:#FFD23F;font-size:20px">Retlify</b></div><div style="padding:32px"><p>Hi ${user.name},</p><p style="margin:16px 0">Click below to reset your password:</p><a href="${url}" style="display:inline-block;background:#FFD23F;color:#1a1d23;font-weight:700;padding:13px 24px;border-radius:10px;text-decoration:none">Reset Password</a><p style="color:#6B7280;font-size:13px;margin-top:20px">Expires in 1 hour. - Retlify Team</p></div></div>` });
    } catch(e) { user.resetToken = null; user.resetTokenExpiry = null; await user.save({ validateBeforeSave: false }); return res.status(500).json({ message: 'Failed to send email.' }); }
    res.json({ message: GENERIC });
  } catch (err) { console.error('[forgot]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* POST /api/auth/reset-password */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)  return res.status(400).json({ message: 'Token and password required.' });
    if (newPassword.length < 8)  return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    const user   = await User.findOne({ resetToken: hashed, resetTokenExpiry: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ message: 'Reset link is invalid or expired.' });
    user.password = newPassword; user.resetToken = null; user.resetTokenExpiry = null;
    await user.save();
    res.json({ message: 'Password reset successfully.' });
  } catch (err) { console.error('[reset]', err); res.status(500).json({ message: 'Server error.' }); }
});

/* GET /api/auth/me  - fresh user profile (requires auth)
 * Dashboard calls this on load to re-hydrate localStorage with the complete
 * user record so nothing is missing after Google login or long sessions.
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ user: safe(user) });
  } catch (err) {
    console.error('[me]', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
