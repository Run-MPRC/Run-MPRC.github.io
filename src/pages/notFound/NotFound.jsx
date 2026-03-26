import React from 'react';
import { Link } from 'react-router-dom';
import './notFound.css';
import SEO from '../../components/SEO';

function NotFound() {
  return (
    <section>
      <SEO title="Page Not Found" noindex />
      <div className="container notFound__container">
        <h2>Page Not Found</h2>
        <p>Sorry, the page you&apos;re looking for doesn&apos;t exist.</p>
        <Link to="/" className="btn">
          Go Back Home
        </Link>
      </div>
    </section>
  );
}

export default NotFound;
