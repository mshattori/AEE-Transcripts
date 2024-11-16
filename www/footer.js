document.addEventListener('DOMContentLoaded', function () {
    const footer = document.querySelector('.footer');
    const scrollPercentage = document.getElementById('scrollPercentage');

    window.addEventListener('scroll', function () {
        let scrollTop = window.scrollY || document.documentElement.scrollTop;
        let docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        let scrolled = (scrollTop / docHeight) * 100;

        scrollPercentage.textContent = scrolled.toFixed(0) + '%';

        footer.style.display = 'block';
        // Add a timeout to hide the footer after a certain time
        clearTimeout(footer._hideTimeout);
        footer._hideTimeout = setTimeout(() => {
            footer.style.display = 'none';
        }, 1000);
    });
});
