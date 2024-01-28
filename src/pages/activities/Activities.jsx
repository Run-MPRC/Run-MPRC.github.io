import React from 'react';
import './activities.css';
import HeaderImage from '../../images/activities/header_bg_1.jpg';
import Header from '../../components/Header';
import Subheader from '../../components/Subheader';
import Paragraph from '../../components/Paragraph';
import ImageCarousel from '../../components/ImageCarousel';
import MetaText from '../../components/MetaText';

import Brunch1 from '../../images/activities/brunch1.jpeg';
import Brunch2 from '../../images/activities/brunch2.jpeg';
import Brunch3 from '../../images/activities/brunch3.jpeg';

import Activity1 from '../../images/activities/activity1.jpeg';
import Activity2 from '../../images/activities/social1.jpeg';

import Extra1 from "../../images/activities/extra1.jpg";
import Extra2 from "../../images/activities/extra2.jpeg";
import Extra3 from "../../images/activities/extra3.jpeg";
import FlexColumnContainer from "../../components/FlexColumnContainer";

const brunchImages = [Brunch1, Brunch2, Brunch3];
const activityImages = [Activity1, Activity2];
const extraImages = [Extra1, Extra2, Extra3];

function Activities() {
  return (
    <>
      <Header title="Activities" image={HeaderImage} />
      <FlexColumnContainer>
        <div className="first:mt-8">
          <Subheader title="Saturday Morning Run" />
        </div>
        <Paragraph>
          Every Saturday morning, we run on the part of the Bay trail near
          downtown San Mateo. We meet in Seal Point Park near the green marker
          on the map listed below - come rain or shine. We welcome all paces and
          walkers as well. To get our starting time,
          {' '}
          <a href="https://docs.google.com/forms/d/e/1FAIpQLSd574vmu9CgznB3JxV01Vkjz3RijuhbHEqb6pCCRuC6s7DiHg/viewform">
            fill out the waiver
          </a>
          , and come join us!
        </Paragraph>
        <Subheader title="Brunch" />
        <Paragraph>
          &ldquo;We love to eat just as much as we love to run (or more). After most
          Saturday runs, we organize a group of folks that would like to hang
          out in a restaurant in the community.&rdquo;
        </Paragraph>
        <ImageCarousel images={brunchImages} />
        <Subheader title="Run Club Social" />
        <Paragraph>
          Celebrate the end of each month with our Run Club Socials! These
          gatherings are a fantastic way to connect with other members over
          homemade goodies, fruits, and refreshing beverages, provided by the
          club.
        </Paragraph>
        <ImageCarousel images={activityImages} />
        <h2 className="my-8">And sometimes, we just like to hang out…</h2>
        <Paragraph>
          Celebrate the end of each month with our Run Club Socials! These
          gatherings are a fantastic way to connect with other members over
          homemade goodies, fruits, and refreshing beverages, provided by the
          club.
        </Paragraph>
        <ImageCarousel images={extraImages} />
      </FlexColumnContainer>
    </>
  );
}

export default Activities;
