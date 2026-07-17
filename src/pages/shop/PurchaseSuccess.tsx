import React, {
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { lookupOrder, OrderLookupResult, formatPrice } from '../../services/shop/shopService';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;
const objectIdentities = new WeakMap<object, number>();
let nextObjectIdentity = 1;

function getObjectIdentity(value: object | null): number {
  if (value === null) return 0;
  const existing = objectIdentities.get(value);
  if (existing !== undefined) return existing;
  const identity = nextObjectIdentity;
  nextObjectIdentity += 1;
  objectIdentities.set(value, identity);
  return identity;
}

function getOwnDataValue(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function getLookupErrorCode(error: unknown): string {
  const directCode = getOwnDataValue(error, 'code');
  if (directCode) return typeof directCode === 'string' ? directCode : '';
  const details = getOwnDataValue(error, 'details');
  const nestedCode = getOwnDataValue(details, 'code');
  return typeof nestedCode === 'string' ? nestedCode : '';
}

type LookupApp = Parameters<typeof lookupOrder>[0];
type ViewPhase = 'waiting' | 'confirmed' | 'timeout' | 'error' | 'denied';

type PurchaseSuccessAttemptProps = {
  app: LookupApp | null;
  isReady: boolean;
  orderId: string | null;
  token: string | null;
};

type CommittedRoute = {
  orderId: string | null;
  token: string | null;
  epoch: number;
};

function isSameRoute(
  committed: CommittedRoute,
  orderId: string | null,
  token: string | null,
): boolean {
  return committed.orderId === orderId && committed.token === token;
}

function PurchaseSuccessAttempt({
  app,
  isReady,
  orderId,
  token,
}: PurchaseSuccessAttemptProps) {
  const hasRequiredParams = Boolean(orderId && token);
  const [view, setView] = useState<{
    phase: ViewPhase;
    order: OrderLookupResult | null;
  }>(() => ({
    phase: isReady && !hasRequiredParams ? 'error' : 'waiting',
    order: null,
  }));
  const { phase, order } = view;

  useLayoutEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const activeApp = app;

    function settle(
      nextPhase: ViewPhase,
      nextOrder: OrderLookupResult | null = null,
    ) {
      if (!active) return;
      setView({ phase: nextPhase, order: nextOrder });
    }

    function stop() {
      active = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    if (!isReady || !activeApp || !hasRequiredParams) {
      settle(isReady && !hasRequiredParams ? 'error' : 'waiting');
      return stop;
    }

    settle('waiting');
    const lookupApp = activeApp;
    const started = Date.now();

    async function tick() {
      if (!active) return;
      timer = null;
      try {
        const result = await lookupOrder(lookupApp, {
          orderId: orderId!,
          token: token!,
        });
        if (!active) return;
        if (result.status === 'paid' || result.status === 'fulfilled') {
          settle('confirmed', result);
          return;
        }
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          settle('timeout');
          return;
        }
        settle('waiting');
        if (!active) return;
        timer = setTimeout(() => {
          tick().catch(() => {
            settle('error');
          });
        }, POLL_INTERVAL_MS);
      } catch (err: unknown) {
        if (!active) return;
        const code = getLookupErrorCode(err);
        if (code === 'permission-denied') {
          settle('denied');
        } else {
          settle('error');
        }
      }
    }

    tick().catch(() => {
      settle('error');
    });
    return stop;
  }, [app, hasRequiredParams, isReady, orderId, token]);

  return (
    <>
      <SEO title="Purchase complete" noindex />
      <div className="container mx-auto p-6 max-w-xl text-center">
        {phase === 'waiting' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Processing your order...</h1>
            <p className="text-gray-600">
              Confirming your payment with Stripe.
            </p>
          </>
        )}
        {phase === 'confirmed' && order && (
          <>
            <h1 className="text-3xl font-bold mb-2">Order confirmed!</h1>
            <p className="text-gray-800">
              Thanks,
              {' '}
              {order.buyer.firstName}
              . We&apos;ll email shipping details to
              {' '}
              <strong>{order.buyer.email}</strong>
              .
            </p>
            <div className="mt-4 text-sm text-gray-700 text-left inline-block border rounded p-3 bg-gray-50">
              <div>
                <strong>Item:</strong>
                {' '}
                {order.productTitle}
                {order.size ? ` · size ${order.size}` : ''}
                {order.color ? ` · ${order.color}` : ''}
              </div>
              <div>
                <strong>Total:</strong>
                {' '}
                {formatPrice(order.amountCents)}
              </div>
              <div>
                <strong>Order ID:</strong>
                {' '}
                <code>{order.id}</code>
              </div>
            </div>
          </>
        )}
        {phase === 'timeout' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Still processing...</h1>
            <p className="text-gray-700">
              You&apos;ll get an email once it&apos;s confirmed.
            </p>
          </>
        )}
        {phase === 'denied' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Can&apos;t confirm this order</h1>
            <p className="text-gray-700">This confirmation link isn&apos;t valid.</p>
          </>
        )}
        {phase === 'error' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-gray-700">Please contact us with your email.</p>
          </>
        )}
        <Link to="/shop" className="inline-block mt-6 text-blue-600 hover:underline">
          ← Back to shop
        </Link>
      </div>
    </>
  );
}

function PurchaseSuccess() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { services, isReady } = useServiceLocator();
  const orderId = params.get('order');
  const token = params.get('token');
  const app = services?.firebaseResources.app ?? null;
  const committedRouteRef = useRef<CommittedRoute | null>(null);
  const [, setRouteCommitVersion] = useState(0);

  if (committedRouteRef.current === null) {
    committedRouteRef.current = {
      orderId,
      token,
      epoch: 1,
    };
  }

  const committedRoute = committedRouteRef.current;
  const routeIsCommitted = isSameRoute(committedRoute, orderId, token);

  useLayoutEffect(() => {
    const { current } = committedRouteRef;
    if (current && isSameRoute(current, orderId, token)) return;
    committedRouteRef.current = {
      orderId,
      token,
      epoch: (current?.epoch ?? 0) + 1,
    };
    setRouteCommitVersion((version) => version + 1);
  }, [orderId, token]);

  if (!routeIsCommitted) {
    const hasRequiredParams = Boolean(orderId && token);
    return (
      <>
        <SEO title="Purchase complete" noindex />
        <div className="container mx-auto p-6 max-w-xl text-center">
          {isReady && !hasRequiredParams ? (
            <>
              <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
              <p className="text-gray-700">Please contact us with your email.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold mb-2">Processing your order...</h1>
              <p className="text-gray-600">
                Confirming your payment with Stripe.
              </p>
            </>
          )}
          <Link to="/shop" className="inline-block mt-6 text-blue-600 hover:underline">
            ← Back to shop
          </Link>
        </div>
      </>
    );
  }

  const attemptKey = JSON.stringify([
    location.key,
    committedRoute.epoch,
    getObjectIdentity(services ?? null),
    getObjectIdentity(app),
    isReady ? 1 : 0,
  ]);

  return (
    <PurchaseSuccessAttempt
      key={attemptKey}
      app={app}
      isReady={isReady}
      orderId={orderId}
      token={token}
    />
  );
}

export default PurchaseSuccess;
