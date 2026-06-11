import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { lookupOrder, OrderLookupResult, formatPrice } from '../../services/shop/shopService';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

function PurchaseSuccess() {
  const [params] = useSearchParams();
  const { services, isReady } = useServiceLocator();
  const orderId = params.get('order');
  const token = params.get('token');

  const [order, setOrder] = useState<OrderLookupResult | null>(null);
  const [state, setState] = useState<'waiting' | 'confirmed' | 'timeout' | 'error' | 'denied'>(
    'waiting',
  );
  const stopRef = useRef(false);

  useEffect(() => {
    if (!isReady || !services || !orderId || !token) {
      if (isReady && (!orderId || !token)) setState('error');
      return undefined;
    }
    stopRef.current = false;
    const started = Date.now();

    async function tick() {
      if (stopRef.current) return;
      try {
        const result = await lookupOrder(services!.firebaseResources.app, {
          orderId: orderId!,
          token: token!,
        });
        setOrder(result);
        if (result.status === 'paid' || result.status === 'fulfilled') {
          setState('confirmed');
          return;
        }
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          setState('timeout');
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err: any) {
        const code = err?.code || err?.details?.code || '';
        if (code === 'permission-denied') setState('denied');
        else setState('error');
      }
    }

    tick();
    return () => { stopRef.current = true; };
  }, [isReady, services, orderId, token]);

  return (
    <>
      <SEO title="Purchase complete" noindex />
      <div className="container mx-auto p-6 max-w-xl text-center">
        {state === 'waiting' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Processing your order...</h1>
            <p className="text-gray-600">
              Confirming your payment with Stripe.
            </p>
          </>
        )}
        {state === 'confirmed' && order && (
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
        {state === 'timeout' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Still processing...</h1>
            <p className="text-gray-700">
              You&apos;ll get an email once it&apos;s confirmed.
            </p>
          </>
        )}
        {state === 'denied' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Can&apos;t confirm this order</h1>
            <p className="text-gray-700">This confirmation link isn&apos;t valid.</p>
          </>
        )}
        {state === 'error' && (
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

export default PurchaseSuccess;
