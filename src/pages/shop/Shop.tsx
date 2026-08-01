import React from 'react';
import SEO from '../../components/SEO';
import Header from '../../components/Header';
import HeaderImage from '../../images/home/mprc_home.jpg';

const PICKUP_PAYMENT_INSTRUCTIONS = [
  'Check availability with the Treasurer at a club run. ',
  'Pickup is in person. ',
  'If payment is still due, pay the Treasurer by cash or Venmo.',
].join('');

const PICKUP_SHOP_ITEMS = Object.freeze([
  Object.freeze({
    id: 'mprc-hat',
    title: 'MPRC Hat',
    priceCents: 1000,
  }),
  Object.freeze({
    id: 'mprc-jacket',
    title: 'MPRC Jacket',
    priceCents: 2500,
  }),
]);

const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function Shop() {
  return (
    <>
      <SEO
        title="MPRC Shop"
        description="Mid-Peninsula Running Club hat and jacket prices. Check availability with the Treasurer for in-person pickup at a club run; no online ordering."
        url="https://runmprc.com/shop"
        canonicalUrl="https://runmprc.com/shop"
      />
      <Header title="MPRC Shop" image={HeaderImage}>
        Club merchandise for in-person pickup at a club run.
      </Header>
      <div className="container mx-auto p-4 max-w-5xl">
        <section
          aria-labelledby="pickup-shop-heading"
          className="mt-8 mb-12"
        >
          <div className="max-w-3xl mb-8">
            <h2 id="pickup-shop-heading" className="text-2xl font-bold mb-3">
              In-person club merchandise
            </h2>
            <p className="text-lg font-semibold text-gray-100 mb-2">
              These items are not sold through this page.
            </p>
            <p className="text-gray-200">
              Ask the Treasurer about current availability when you attend a
              club run.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PICKUP_SHOP_ITEMS.map((item) => {
              const headingId = `${item.id}-heading`;

              return (
                <article
                  key={item.id}
                  aria-labelledby={headingId}
                  className="card text-left"
                >
                  <p className="text-sm font-semibold uppercase tracking-wide text-gray-200 mb-3">
                    In-person pickup
                  </p>
                  <h3 id={headingId} className="text-2xl font-bold mb-3">
                    {item.title}
                  </h3>
                  <p className="text-3xl font-bold text-white mb-5">
                    {priceFormatter.format(item.priceCents / 100)}
                  </p>
                  <p className="text-gray-100">
                    {PICKUP_PAYMENT_INSTRUCTIONS}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

export default Shop;
