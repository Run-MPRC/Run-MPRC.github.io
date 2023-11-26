import React from 'react';
import { Container, ListGroup } from 'react-bootstrap';

const Activities = () => {
  return (
    <Container>
      <h2 className="my-4">Activities</h2>
      <ListGroup>
        <ListGroup.Item>Saturday morning Bay Trail runs of up to 6 miles or up to one hour.</ListGroup.Item>
        <ListGroup.Item>Monthly Social Gathering with coffee, tea, and pastries.</ListGroup.Item>
        <ListGroup.Item>Exclusive social events throughout the year for MPRC members.</ListGroup.Item>
      </ListGroup>
    </Container>
  );
}

export default Activities;
