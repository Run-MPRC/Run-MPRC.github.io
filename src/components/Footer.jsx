import React from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFacebook,
  faStrava,
  faInstagram,
} from '@fortawesome/free-brands-svg-icons';
import Logo from '../assets/images/logo.svg';
import { FB_URI, STRAVA_URI, INSTAGRAM_URI } from '../text/externalLinks';
import { COPYRIGHT, DESC, DISCLAIMER } from '../text/Footer';

function Footer() {
  return (
    <footer>
      <div className="container footer__container">
        <article>
          <Link to="/" className="logo">
            <img src={Logo} alt="MPRC Logo" />
          </Link>
          <p>{DESC}</p>
          <div className="footer__socials">
            <a href={FB_URI} target="_blank" rel="noreferrer noopener" aria-label="Visit our Facebook page">
              <FontAwesomeIcon icon={faFacebook} />
            </a>
            <a href={STRAVA_URI} target="_blank" rel="noreferrer noopener" aria-label="Visit our Strava club">
              <FontAwesomeIcon icon={faStrava} />
            </a>
            <a href={INSTAGRAM_URI} target="_blank" rel="noreferrer noopener" aria-label="Visit our Instagram page">
              <FontAwesomeIcon icon={faInstagram} />
            </a>
          </div>
        </article>
        <article>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/activities">Activities</Link>
          <Link to="/committee">Committee</Link>
          <Link to="/joinus">Join Us</Link>
          <Link to="/contact">Contact Us</Link>
        </article>
      </div>
      <div className="footer__copyright">
        <small>
          {' '}
          &copy;
          {COPYRIGHT}
        </small>
      </div>
      <div className="footer__disclaimer">
        <small>
          {DISCLAIMER}
        </small>
      </div>
    </footer>
  );
}

export default Footer;
