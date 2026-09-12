// Resource limits for the two small account-profile operations only.
// These reduce idle/scaling exposure; they are not a monthly spending cap.
module.exports = Object.freeze({
  minInstances: 0,
  maxInstances: 2,
  memory: '256MB',
  timeoutSeconds: 30,
});
