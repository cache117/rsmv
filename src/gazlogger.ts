const getTime = () => {
	return (new Date()).toISOString();
};
const log = (...x) => {
	console.log(`[${getTime()}]`, ...x);

};

export default log;