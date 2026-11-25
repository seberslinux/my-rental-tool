/**
 * My Rental Tool as an MCP server, so Claude (web, desktop, phone, Claude
 * Code) can read the numbers and act on them: <APP_URL>/mcp.
 *
 * Claude signs in through OAuth (oauth.js, consent.js) with the person's
 * own app account; each request then runs as that person (internal.js).
 * Stateless: every request gets a fresh server, nothing is kept between.
 */

const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { provider } = require('./oauth');
const { register } = require('./tools');

const issuer = () => new URL((process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''));

/** The routes: OAuth at the root (/authorize, /token, /register, /.well-known/…), the consent page, and /mcp. */
function mcpRoutes(app, { disableRateLimits = false } = {}) {
  const router = express.Router();
  const base = issuer();
  const mcpUrl = new URL('/mcp', base);
  const limits = disableRateLimits ? { rateLimit: false } : {};

  router.use(mcpAuthRouter({
    provider, issuerUrl: base, resourceServerUrl: mcpUrl, resourceName: 'My Rental Tool',
    authorizationOptions: limits, tokenOptions: limits, clientRegistrationOptions: limits, revocationOptions: limits,
  }));
  router.use('/oauth', require('./consent'));

  const bearer = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });
  router.post('/mcp', bearer, async (req, res) => {
    const server = new McpServer({ name: 'my-rental-tool', version: '1.0.0' }, {
      instructions: 'Short-term rentals in Scarborough, Cape Town, managed through Smoobu. Money is in rand (R). '
        + 'Net revenue = gross − commission − bank charges − VAT on those. Ask before changing rates or creating payment links.',
    });
    register(server, { app, userOf: (extra) => extra.authInfo.extra.user });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('mcp:', err.message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  router.all('/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
  return router;
}

module.exports = { mcpRoutes };
