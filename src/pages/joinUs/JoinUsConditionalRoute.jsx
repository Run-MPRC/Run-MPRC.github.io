import React from 'react';
import JoinUs from './JoinUs';
import Header from '../../components/Header';
import HeaderImage from '../../images/joinus/header_bg_1.jpg';
import { JOIN_US_TITLE } from '../../text/JoinUs';

function JoinUsConditionalRoute() {
  return (
    <>
      <Header title={JOIN_US_TITLE} image={HeaderImage} />
      <JoinUs />
    </>
  );
}

export default JoinUsConditionalRoute;
