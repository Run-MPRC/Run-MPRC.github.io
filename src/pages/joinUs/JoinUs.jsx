import React from 'react';
import { Link } from 'react-router-dom';
import './joinUs.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle, faMeetup } from '@fortawesome/free-brands-svg-icons';
import Header from '../../components/Header';
import HeaderImage from '../../images/joinus/header_bg_1.jpg';
import {
  ARM,
  GOOGLE_FORM,
  H2_JOIN_US,
  JOIN_US_DESCRIPTION_1,
  JOIN_US_DESCRIPTION_2,
  JOIN_US_DESCRIPTION_3,
  JOIN_US_DESCRIPTION_4,
  JOIN_US_DESCRIPTION_5,
  JOIN_US_TITLE,
  LI_ACCESS_TO_STRAVA_FACEBOOK,
  LI_AFFORDABLE_MEMBERSHIP_FEES,
  LI_CLUB_GATHERINGS,
  LI_CLUB_LOGO_MERCHANDISE,
  LI_CLUB_SUPPORT_NETWORKING,
  LI_DISCOUNT_ON_SHOES,
  LI_EASY_ANNUAL_RENEWAL_PROCESS,
  LI_MONTHLY_NEWSLETTERS,
  LI_RACE_DISCOUNT_CODES,
  LI_SATURDAY_CLUB_RUNS,
  LI_SOCIAL_RACE_ACTIVITIES,
  MEETUP_GROUP,
  JOIN_US_BUTTON_1,
  JOIN_US_BUTTON_2,
} from '../../text/JoinUs';
import Card from '../../UI/Card';
import {
  ARM_URI,
  GOOGLE_FORM_LINK,
  MEETUP_URI,
} from "../../text/externalLinks";
import MetaText from "../../components/MetaText";
import { RouteLeaflet } from "./RouteLeaflet";

const sectionRunWithUs = () => (
  <Card className="joinus__card">
    <h2 className="h2_joinus">Ways To Run With Us</h2>
    <ul className="ul_joinus">
      <li className="li_joinus">
        {JOIN_US_DESCRIPTION_1}
        <a
          href={MEETUP_URI}
          target="_blank"
          rel="noreferrer noopener"
        >
          {MEETUP_GROUP}
          {' '}
          <FontAwesomeIcon icon={faMeetup} />
          .
        </a>
      </li>
      <li className="li_joinus">{JOIN_US_DESCRIPTION_2}</li>
      <li className="li_joinus">{JOIN_US_DESCRIPTION_3}</li>
    </ul>
    <Link
      to={MEETUP_URI}
      className="btn lg"
      target="_blank"
      rel="noopener noreferrer"
    >
      {JOIN_US_BUTTON_1}
    </Link>
  </Card>
);

const sectionBecomeMember = () => (
  <Card className="joinus__card">
    <h2 className="h2_joinus">Become A Member</h2>
    <ul className="ul_joinus">
      <li className="li_joinus">
        {JOIN_US_DESCRIPTION_4}
        <a
          href={GOOGLE_FORM_LINK}
          target="_blank"
          rel="noreferrer noopener"
        >
          {GOOGLE_FORM}
          {' '}
          <FontAwesomeIcon icon={faGoogle} />
          .
          {' '}
        </a>
      </li>
      <li className="li_joinus">{JOIN_US_DESCRIPTION_5}</li>
    </ul>
    <Link
      to={GOOGLE_FORM_LINK}
      className="btn lg"
      target="_blank"
      rel="noopener noreferrer"
    >
      {JOIN_US_BUTTON_2}
    </Link>
  </Card>
);

const sectionMemberBenefits = () => (
  <Card className="joinus__card">
    <h2 className="h2_joinus">{H2_JOIN_US}</h2>
    <ul>
      <li className="li_joinus">{LI_SATURDAY_CLUB_RUNS}</li>
      <li className="li_joinus">{LI_CLUB_SUPPORT_NETWORKING}</li>
      <li className="li_joinus">{LI_CLUB_GATHERINGS}</li>
      <li className="li_joinus">{LI_MONTHLY_NEWSLETTERS}</li>
      <li className="li_joinus">{LI_CLUB_LOGO_MERCHANDISE}</li>
      <li className="li_joinus">{LI_SOCIAL_RACE_ACTIVITIES}</li>
      <li className="li_joinus">{LI_RACE_DISCOUNT_CODES}</li>
      <li className="li_joinus">
        {LI_DISCOUNT_ON_SHOES}
        <a href={ARM_URI} target="_blank" rel="noreferrer noopener">
          {ARM}
        </a>
      </li>
      <li className="li_joinus">{LI_ACCESS_TO_STRAVA_FACEBOOK}</li>
      <li className="li_joinus">{LI_AFFORDABLE_MEMBERSHIP_FEES}</li>
      <li className="li_joinus">{LI_EASY_ANNUAL_RENEWAL_PROCESS}</li>
    </ul>
  </Card>
);

function JoinUs() {
  return (
    <>
      <Header title={JOIN_US_TITLE} image={HeaderImage} />

      <section className="joinus">
      <MetaText>Saturday Morning Route</MetaText>
      <RouteLeaflet />
        <div className="container joinus__container">
          <div className="joinus__wrapper">
            {sectionRunWithUs()}
            &nbsp;&nbsp;
            {sectionBecomeMember()}
            &nbsp;&nbsp;
            {sectionMemberBenefits()}
          </div>
        </div>
      </section>
    </>
  );
}

export default JoinUs;
