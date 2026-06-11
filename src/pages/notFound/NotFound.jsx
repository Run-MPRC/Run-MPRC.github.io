import React from 'react';
import { Link } from 'react-router-dom';
import './notFound.css';
import SEO from '../../components/SEO';

const SUGGESTIONS = [
  { to: '/', label: 'Home', desc: 'Club info, history, and what we do' },
  { to: '/events', label: 'Events', desc: 'Upcoming runs, races, socials' },
  { to: '/shop', label: 'Shop', desc: 'MPRC merch — hats, jackets' },
  { to: '/joinus', label: 'Join Us', desc: 'Become a member' },
  { to: '/contact', label: 'Contact', desc: 'Get in touch' },
];

function NotFound() {
  return (
    <section>
      <SEO title="Page Not Found" noindex />
      <div className="container mx-auto px-4 py-12 max-w-2xl text-center">
        <p className="text-6xl font-bold text-blue-600">404</p>
        <h2 className="text-2xl font-bold mt-2">Page not found</h2>
        <p className="text-gray-600 mt-2">
          We couldn&apos;t find the page you were looking for. Maybe one of these will help.
        </p>

        <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          {SUGGESTIONS.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                className="block border rounded-lg p-3 hover:bg-gray-50 hover:border-blue-300 transition"
              >
                <div className="font-semibold text-blue-700">{s.label}</div>
                <div className="text-sm text-gray-600">{s.desc}</div>
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-xs text-gray-500 mt-8">
          If you got here from a link on the site, please
          {' '}
          <Link to="/contact" className="underline">let us know</Link>
          {' '}
          so we can fix it.
        </p>
      </div>
    </section>
  );
}

export default NotFound;
