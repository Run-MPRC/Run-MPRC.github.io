import React from "react";
import "./joinUs.css";
import Header from "../../components/Header";
import HeaderImage from "../../images/joinus/header_bg_1.jpg";
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
} from "../../text/JoinUs";
import Card from "../../UI/Card";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGoogle, faMeetup } from "@fortawesome/free-brands-svg-icons";
import {
  ARM_URI,
  GOOGLE_FORM_LINK,
  MEETUP_URI,
} from "../../text/externalLinks";

const sectionRunWithUs = () => {
  return (
    <Card className="joinus__card">
      <h2 className="h2_joinus">Ways To Run With Us</h2>
      <ul>
        <li className="li_joinus">
          {JOIN_US_DESCRIPTION_1}
          <a
            href={MEETUP_URI}
            target="_blank"
            rel="noreferrer noopener"
          >
            {MEETUP_GROUP} <FontAwesomeIcon icon={faMeetup} />.
          </a>
        </li>
        <li className="li_joinus">{JOIN_US_DESCRIPTION_2}</li>
        <li className="li_joinus">{JOIN_US_DESCRIPTION_3}</li>
      </ul>
    </Card>
  );
}

const sectionBecomeMember = () => {
  return (
    <Card className="joinus__card">
      <h2 className="h2_joinus">Become A Member</h2>
      <ul>
        <li className="li_joinus">
          {JOIN_US_DESCRIPTION_4}
          <a
            href={GOOGLE_FORM_LINK}
            target="_blank"
            rel="noreferrer noopener"
          >
            {GOOGLE_FORM} <FontAwesomeIcon icon={faGoogle} />.{" "}
          </a>
        </li>
        <li className="li_joinus">{JOIN_US_DESCRIPTION_5}</li>
      </ul>
    </Card>
  );
}

const sectionMemberBenefits = () => {
  return (
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
  )
}

const JoinUs = () => {
  return (
    <>
      <Header title={JOIN_US_TITLE} image={HeaderImage}></Header>

      <section className="joinus">
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
};

export default JoinUs;
