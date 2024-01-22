import React from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFacebook,
  faMeetup,
  faStrava,
} from '@fortawesome/free-brands-svg-icons';
import Logo from '../assets/images/logo.svg';
import { FB_URI, MEETUP_URI, STRAVA_URI } from '../text/externalLinks';
import { COPYRIGHT, DESC } from '../text/Footer';

function Footer() {
  return (
    <footer>
      <div className="container footer__container">
        <article>
          <Link to="/" className="logo">
            <img src={Logo} alt="Footer Logo" />
          </Link>
          <p>{DESC}</p>
          <div className="footer__socials">
            <a href={MEETUP_URI} target="_blank" rel="noreferrer noopener" aria-label="Meetup">
              <FontAwesomeIcon icon={faMeetup} />
            </a>
            <a href={FB_URI} target="_blank" rel="noreferrer noopener" aria-label="Facebook">
              <FontAwesomeIcon icon={faFacebook} />
            </a>
            <a href={STRAVA_URI} target="_blank" rel="noreferrer noopener" aria-label="Strava">
              <FontAwesomeIcon icon={faStrava} />
            </a>
          </div>
        </article>
        {/* <article>
          <h4>Permalinks</h4>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/activities">Activities</Link>
          <Link to="/committee">Committee</Link>
          <Link to="/joinus">Join US</Link>
          <Link to="/contact">Contact Us</Link>
        </article> */}
      </div>
      <div className="footer__copyright">
        <small>
          {' '}
          &copy;
          {COPYRIGHT}
        </small>
      </div>
    </footer>
  );
}

export default Footer;
