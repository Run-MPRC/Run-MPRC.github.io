import React from 'react';
import { Link } from 'react-router-dom';
import {
  HOME_HERO_BUTTON_TEXT,
  HOME_HERO_TEXT_1,
  HOME_HERO_TEXT_2,
} from '../text/Home';
import { MEETUP_URI } from '../text/externalLinks';

function MainHeader() {
  return (
    <header className="main__header">
      <div className="main__header-background">
        <div className="container main__header-container">
          <h1>{HOME_HERO_TEXT_1}</h1>
          <p>{HOME_HERO_TEXT_2}</p>
          <Link
            to={MEETUP_URI}
            className="btn lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            {HOME_HERO_BUTTON_TEXT}
          </Link>
        </div>
      </div>
    </header>
  );
}

export default MainHeader;
