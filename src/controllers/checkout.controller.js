import { createCheckoutSession } from '../services/stripe.service.js';

export async function createCheckout(req, res) {
  const { email, name } = req.body;
  const result = await createCheckoutSession({ email, name });
  res.status(200).json({
    success: true,
    data: {
      sessionId: result.sessionId,
      url: result.url,
    },
  });
}

export function handleCheckoutSuccess(req, res) {
  const sessionId = req.query.session_id || null;
  res.status(200).json({
    success: true,
    message: 'Checkout completed successfully! Your subscription is active.',
    sessionId,
  });
}

export function handleCheckoutCancel(req, res) {
  res.status(200).json({
    success: true,
    message: 'Checkout session was cancelled.',
  });
}
