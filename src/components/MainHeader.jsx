import React from 'react';
/* import { Link } from 'react-router-dom'; */
import {
  /* HOME_HERO_BUTTON_TEXT, */
  HOME_HERO_TEXT_1,
  HOME_HERO_TEXT_2,
} from '../text/Home';
/* import { MEETUP_URI } from '../text/externalLinks'; */

function MainHeader() {
  return (
    <header className="main__header" role="banner">
      <div className="main__header-background">
        <div className="container main__header-container">
          <h1 itemProp="name">{HOME_HERO_TEXT_1}</h1>
          <p itemProp="description">{HOME_HERO_TEXT_2}</p>
          <meta itemProp="location" content="San Mateo, California" />
          <meta itemProp="sport" content="Running" />
          <meta itemProp="foundingDate" content="1988" />
          {/* <Link
            to={MEETUP_URI}
            className="btn lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            {HOME_HERO_BUTTON_TEXT}
          </Link> */}
        </div>
      </div>
    </header>
  );
}

export default MainHeader;
