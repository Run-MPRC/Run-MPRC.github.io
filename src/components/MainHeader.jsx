import React from 'react';
import {
  HOME_HERO_TEXT_1,
  HOME_HERO_TAGLINE,
  HOME_HERO_TEXT_2,
} from '../text/Home';

function MainHeader() {
  return (
    <header className="main__header" role="banner">
      <div className="main__header-background">
        <div className="container main__header-container">
          <h1 itemProp="name">{HOME_HERO_TEXT_1}</h1>
          <p className="hero-tagline">{HOME_HERO_TAGLINE}</p>
          <p itemProp="description">{HOME_HERO_TEXT_2}</p>
          <meta itemProp="location" content="San Mateo, California" />
          <meta itemProp="sport" content="Running" />
          <meta itemProp="foundingDate" content="1988" />
        </div>
      </div>
    </header>
  );
}

export default MainHeader;
